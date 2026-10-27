import { expect, test } from 'bun:test'
import { managedClubs, validateClub } from '../clubs'

const input = {
    language: 'de',
    title: 'Club',
    descriptionHtml:
        '<p>Hello<script>bad()</script><img src="https://media.example/a.png" onerror="evil()"><a href="javascript:evil()">link</a></p>',
    sourceUrl: 'https://example.org',
    links: [],
    version: null
}
test('sanitizes rich descriptions and keeps a plain fallback', () => {
    const club = validateClub(input)
    expect(club.descriptionHtml).not.toContain('script')
    expect(club.descriptionHtml).not.toContain('onerror')
    expect(club.descriptionHtml).not.toContain('javascript:')
    expect(club.description).toBe('Hellolink')
})
test('rejects unsafe source URLs and image credentials', () => {
    expect(() =>
        validateClub({ ...input, sourceUrl: 'http://example.org' })
    ).toThrow('InvalidInput')
    expect(
        validateClub({
            ...input,
            descriptionHtml: '<img src="https://user:pass@example.org/a">'
        }).descriptionHtml
    ).not.toContain('src=')
})
test('legacy edited content remains managed with authored translation fallback', () => {
    const content = validateClub(input)
    const rows = [
        {
            editor_id: 'scraped:de:heading-a',
            source_id: 'heading-a',
            language: 'de' as const,
            content,
            version: 'v1'
        },
        {
            editor_id: 'manual:a',
            source_id: null,
            language: 'de' as const,
            content,
            version: 'v2'
        }
    ]
    expect(managedClubs(rows, 'de').map((c) => c.origin)).toEqual([
        'manual',
        'manual'
    ])
    const en = managedClubs(rows, 'en')
    expect(en).toHaveLength(2)
    expect(en[0].contentLanguage).toBe('de')
})

import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createClubsRepository } from '../clubs'

const databaseUrl = process.env.HAWCONNECT_ADMIN_TEST_DATABASE_URL
test.skipIf(!databaseUrl)(
    'club storage uses optimistic versions, translation fallback, audit and deletion',
    async () => {
        const url = new URL(databaseUrl as string)
        if (
            !['127.0.0.1', 'localhost'].includes(url.hostname) ||
            url.pathname !== '/hawconnect_dash_test'
        )
            throw Error('IsolatedAdminTestDatabaseRequired')
        const pool = new Pool({
            connectionString: databaseUrl,
            options: '-c search_path=clubs_editor_test'
        })
        try {
            await pool.query('CREATE SCHEMA clubs_editor_test')
            await pool.query(
                'CREATE TABLE audit_log(entity text,entity_id integer,operation text,name text,user_id text,created_at timestamptz)'
            )
            const migration = await readFile(
                new URL('../../db/accounts/clubs.sql', import.meta.url),
                'utf8'
            )
            await pool.query(migration)
            await pool.query(migration)
            const repository = createClubsRepository(pool)
            const actor = { id: 'fixture-admin' }
            const saved = (await repository.write(input, actor)) as ReturnType<
                typeof managedClubs
            >[number]
            expect(saved.origin).toBe('manual')
            const update = {
                ...input,
                editorId: saved.editorId,
                version: saved.version
            }
            const race = await Promise.allSettled([
                repository.write(update, actor),
                repository.write(update, actor)
            ])
            expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
            expect(
                race
                    .filter((r) => r.status === 'rejected')
                    .map((r) => r.status === 'rejected' && r.reason.message)
            ).toEqual(['Conflict'])
            const current = managedClubs(await repository.list(), 'de')[0]
            const english = (await repository.write(
                {
                    ...update,
                    language: 'en',
                    descriptionHtml: '<p>English</p>',
                    version: current.version
                },
                actor
            )) as ReturnType<typeof managedClubs>[number]
            expect(english.contentLanguage).toBe('en')
            await expect(
                repository.write(
                    { ...input, editorId: 'manual:invented' },
                    actor
                )
            ).rejects.toThrow('InvalidInput')
            await repository.write(
                { editorId: saved.editorId, version: english.version },
                actor,
                true
            )
            expect(await repository.list()).toHaveLength(0)
            expect(
                (await pool.query('SELECT * FROM audit_log')).rows
            ).toHaveLength(4)
            await expect(
                repository.write(
                    {
                        ...input,
                        sourceId: 'heading-de',
                        editorId: 'scraped:de:new'
                    },
                    actor
                )
            ).rejects.toThrow('InvalidInput')
            await pool.query(
                'INSERT INTO haw_club_content(editor_id,source_id,language,content,version) VALUES($1,$2,$3,$4,$5)',
                [
                    'scraped:de:legacy:hash',
                    'legacy',
                    'de',
                    JSON.stringify(validateClub(input)),
                    'old'
                ]
            )
            const legacy = managedClubs(await repository.list(), 'en')[0]
            expect(legacy.origin).toBe('manual')
            const translated = await repository.write(
                {
                    ...input,
                    language: 'en',
                    editorId: legacy.editorId,
                    version: 'old'
                },
                actor
            )
            expect(translated).toMatchObject({
                origin: 'manual',
                contentLanguage: 'en'
            })
            await repository.write(
                {
                    editorId: legacy.editorId,
                    version: (translated as { version: string }).version
                },
                actor,
                true
            )
            expect(await repository.list()).toHaveLength(0)
        } finally {
            await pool.query('DROP SCHEMA IF EXISTS clubs_editor_test CASCADE')
            await pool.end()
        }
    }
)

import { createClubDirectory } from '@/utils/club-directory'

test('managed directory keeps data and timestamp during database outages', async () => {
    let failed = false
    const get = createClubDirectory(async () => {
        if (failed) throw Error('ConnectionLost')
        return [
            {
                editor_id: 'manual:a',
                source_id: null,
                language: 'de',
                content: validateClub(input),
                version: 'v1',
                updated_at: '2026-10-26T12:00:00Z'
            }
        ]
    })
    expect((await get('de')).updatedAt).toBe('2026-10-26T12:00:00.000Z')
    failed = true
    expect(await get('de')).toMatchObject({
        available: true,
        stale: true,
        updatedAt: '2026-10-26T12:00:00.000Z'
    })
    expect((await get('de')).clubs).toHaveLength(1)
    expect(await get('en')).toMatchObject({ available: false, stale: true })
})
test('DB-only directory distinguishes empty managed list from missing storage', async () => {
    expect(await createClubDirectory(async () => [])()).toMatchObject({
        clubs: [],
        available: true,
        stale: false
    })
    expect(await createClubDirectory(null)()).toMatchObject({
        clubs: [],
        available: false,
        stale: true
    })
    expect(
        await createClubDirectory(async () => {
            throw Error('ClubsSetupRequired')
        })()
    ).toMatchObject({ clubs: [], available: false, stale: true })
})
