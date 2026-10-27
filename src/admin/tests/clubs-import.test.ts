import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { importExistingClubs, validateClubImport } from '../clubs-import'

const seed = JSON.parse(
    await readFile(
        new URL('../../data/initial-clubs.json', import.meta.url),
        'utf8'
    )
)
test('reviewed offline seed validates ten clubs and twenty sanitized translations', () => {
    const validated = validateClubImport(seed)
    expect(validated.clubs).toHaveLength(10)
    expect(
        validated.clubs.flatMap((c) => Object.values(c.content))
    ).toHaveLength(20)
    const unsafe = structuredClone(seed)
    unsafe.clubs[0].content.de.descriptionHtml =
        '<p>Hello<script>evil()</script><img src="javascript:evil()" onerror="evil()"></p>'
    expect(validateClubImport(unsafe).clubs[0].content.de.descriptionHtml).toBe(
        '<p>Hello<img /></p>'
    )
    for (const invalid of [
        null,
        { ...seed, importKey: '' },
        { ...seed, clubs: [seed.clubs[0], seed.clubs[0]] }
    ])
        expect(() => validateClubImport(invalid)).toThrow('InvalidClubImport')
})
const database = process.env.HAWCONNECT_ADMIN_TEST_DATABASE_URL
test.skipIf(!database)(
    'offline import is transactional, concurrent-safe and never resurrects edited/deleted seeds',
    async () => {
        const url = new URL(database as string)
        if (
            !['localhost', '127.0.0.1'].includes(url.hostname) ||
            url.pathname !== '/hawconnect_dash_test'
        )
            throw Error('IsolatedAdminTestDatabaseRequired')
        const pool = new Pool({
            connectionString: database,
            options: '-c search_path=clubs_import_test'
        })
        try {
            await pool.query('CREATE SCHEMA clubs_import_test')
            const sql = await readFile(
                new URL('../../db/accounts/clubs.sql', import.meta.url),
                'utf8'
            )
            await pool.query(sql)
            await pool.query(sql)
            await expect(importExistingClubs(pool, seed)).rejects.toThrow(
                'ClubImportFailed'
            )
            expect(
                (await pool.query('SELECT * FROM haw_club_content')).rowCount
            ).toBe(0)
            expect(
                (await pool.query('SELECT * FROM haw_club_imports')).rowCount
            ).toBe(0)
            await pool.query(
                'CREATE TABLE audit_log(entity text,entity_id integer,operation text,name text,user_id text,created_at timestamptz)'
            )
            const results = await Promise.all([
                importExistingClubs(pool, seed),
                importExistingClubs(pool, seed)
            ])
            expect(results.map((r) => r.importedClubs).sort()).toEqual([0, 10])
            expect(
                (await pool.query('SELECT * FROM haw_club_content')).rowCount
            ).toBe(20)
            expect(
                (
                    await pool.query(
                        'SELECT editor_id FROM haw_club_content GROUP BY editor_id HAVING count(DISTINCT version)<>1'
                    )
                ).rowCount
            ).toBe(0)
            expect(
                (
                    await pool.query(
                        'SELECT * FROM haw_club_content WHERE source_id IS NOT NULL OR source_title IS NOT NULL'
                    )
                ).rowCount
            ).toBe(0)
            expect((await pool.query('SELECT * FROM audit_log')).rowCount).toBe(
                10
            )
            await pool.query(
                'DELETE FROM haw_club_content WHERE editor_id=$1',
                [seed.clubs[0].editorId]
            )
            await pool.query(
                "UPDATE haw_club_content SET content=jsonb_set(content,'{title}','\"Edited\"') WHERE editor_id=$1",
                [seed.clubs[1].editorId]
            )
            expect(await importExistingClubs(pool, seed)).toMatchObject({
                alreadyImported: true,
                importedClubs: 0
            })
            expect(
                (await pool.query('SELECT * FROM haw_club_content')).rowCount
            ).toBe(18)
            expect(
                (
                    await pool.query(
                        "SELECT * FROM haw_club_content WHERE content->>'title'='Edited'"
                    )
                ).rowCount
            ).toBe(2)
            await pool.query(
                'TRUNCATE haw_club_content,haw_club_imports,audit_log'
            )
            await pool.query(
                'INSERT INTO haw_club_content(editor_id,source_id,language,content,version) VALUES($1,$2,$3,$4,$5)',
                [
                    `scraped:de:${seed.clubs[0].legacyIds.de}:hash`,
                    seed.clubs[0].legacyIds.de,
                    'de',
                    JSON.stringify({ title: 'Keep legacy' }),
                    'legacy'
                ]
            )
            await pool.query(
                'INSERT INTO haw_club_content(editor_id,language,content,version) VALUES($1,$2,$3,$4)',
                [
                    seed.clubs[1].editorId,
                    'en',
                    JSON.stringify({ title: 'Keep manual' }),
                    'manual'
                ]
            )
            expect(await importExistingClubs(pool, seed)).toMatchObject({
                importedClubs: 8,
                importedTranslations: 16,
                keptClubs: 2
            })
            expect(
                (
                    await pool.query(
                        "SELECT * FROM haw_club_content WHERE content->>'title' IN ('Keep legacy','Keep manual')"
                    )
                ).rowCount
            ).toBe(2)
        } finally {
            await pool.query('DROP SCHEMA IF EXISTS clubs_import_test CASCADE')
            await pool.end()
        }
    }
)

test('import CLI defaults to a database-free dry run and rejects unknown arguments safely', async () => {
    const script = new URL(
        '../../db/accounts/clubs-import-existing.ts',
        import.meta.url
    ).pathname
    const dry = Bun.spawn([process.execPath, script], {
        stdout: 'pipe',
        stderr: 'pipe'
    })
    expect(await dry.exited).toBe(0)
    expect(JSON.parse(await new Response(dry.stdout).text())).toMatchObject({
        mode: 'dry-run',
        clubs: 10,
        translations: 20,
        databaseAccessed: false
    })
    const invalid = Bun.spawn([process.execPath, script, '--unknown'], {
        stdout: 'pipe',
        stderr: 'pipe'
    })
    expect(await invalid.exited).toBe(1)
    expect((await new Response(invalid.stderr).text()).trim()).toBe(
        'InvalidClubImportArguments'
    )
})
