import { afterAll, beforeAll, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { getMigrations } from 'better-auth/db/migration'
import express from 'express'
import { Pool } from 'pg'
import { createAccountAuth } from '@/lib/account-auth'
import { createPublicLegalRouter } from '@/lib/legal-router'
import { createPublicQuickLinksRouter } from '@/lib/quick-links-router'
import { publicCampusLifeEvents } from '@/queries/campus-life'
import { setAdminPassword } from '../password'
import { publicClubEvents } from '../public-events'
import { createAdminRepository } from '../repository'
import { createAdminRouter } from '../router'
import { validateContent } from '../validation'

const database = process.env.HAWCONNECT_ADMIN_TEST_DATABASE_URL
const run = database ? test : test.skip
const origin = 'http://localhost:43127'
let pool: Pool
let server: Server
let base: string
let auth: ReturnType<typeof createAccountAuth>
let repo: ReturnType<typeof createAdminRepository>
const messages = new Map<string, string>()
beforeAll(async () => {
    if (!database) return
    const url = new URL(database)
    if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        !url.pathname.endsWith('/hawconnect_dash_test')
    )
        throw Error('IsolatedAdminTestDatabaseRequired')
    pool = new Pool({ connectionString: database })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    for (const file of (
        await readdir(new URL('../../db/migrations/', import.meta.url))
    )
        .filter((f) => f.endsWith('.sql'))
        .sort())
        await pool.query(
            await readFile(
                new URL(`../../db/migrations/${file}`, import.meta.url),
                'utf8'
            )
        )
    await pool.query(
        await readFile(
            new URL('../../db/accounts/admin.sql', import.meta.url),
            'utf8'
        )
    )
    await pool.query(
        await readFile(
            new URL(
                '../../db/accounts/organizer-profiles.sql',
                import.meta.url
            ),
            'utf8'
        )
    )
    auth = createAccountAuth({
        pool,
        secret: 'isolated-test-secret-at-least-thirty-two-characters',
        baseURL: 'http://localhost:43128',
        webOrigin: origin,
        passwordLogin: true,
        send: async (m) => {
            messages.set(m.email, m.url)
        }
    })
    const migrations = await getMigrations(auth.auth.options)
    await migrations.runMigrations()
    repo = createAdminRepository(pool, ['maintainer@haw-hamburg.de'])
    await pool.query(
        await readFile(
            new URL('../../db/accounts/legal-documents.sql', import.meta.url),
            'utf8'
        )
    )
    await pool.query(
        await readFile(
            new URL('../../db/accounts/quick-links.sql', import.meta.url),
            'utf8'
        )
    )
    const app = express()
    app.use('/api/quick-links', createPublicQuickLinksRouter(pool))
    app.use('/api/legal', createPublicLegalRouter(pool))
    app.use(
        '/api/admin',
        createAdminRouter({
            origin,
            auth,
            repository: repo,
            status: async () => [
                {
                    name: 'Fixture status',
                    available: true,
                    stale: false,
                    updatedAt: null
                }
            ]
        })
    )
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((r) => server.once('listening', r))
    const address = server.address()
    if (!address || typeof address === 'string') throw Error()
    base = `http://127.0.0.1:${address.port}/api/admin`
})
afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (pool) await pool.end()
})
async function request(
    path: string,
    token?: string,
    method = 'GET',
    body?: unknown,
    from = origin
) {
    return fetch(`${base}${path}`, {
        method,
        headers: {
            Origin: from,
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
}
async function signIn(email: string) {
    await pool.query('DELETE FROM haw_rate_limit')
    const headers = {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-HAWConnect-Client': 'native',
        'X-HAWConnect-Client-Ip': email
    }
    const sent = await auth.handler(
        new Request('http://localhost/api/accounts/request-link', {
            method: 'POST',
            headers,
            body: JSON.stringify({ email })
        })
    )
    expect(sent.status).toBe(200)
    const landing = messages.get(email)
    if (!landing) throw Error('No test mail')
    expect(new URL(landing).origin).toBe(origin)
    const token = new URLSearchParams(new URL(landing).hash.slice(1)).get(
        'token'
    )
    const confirmed = await auth.handler(
        new Request('http://localhost/api/accounts/confirm', {
            method: 'POST',
            headers,
            body: JSON.stringify({ token })
        })
    )
    expect(confirmed.status).toBe(200)
    return (await confirmed.json()).token as string
}
const announcement = {
    title: { de: 'Testankündigung', en: 'Test announcement' },
    description: { de: 'Isolierter Test', en: 'Isolated test' },
    startDateTime: '2026-11-01T09:00:00Z',
    endDateTime: '2026-11-02T09:00:00Z',
    platform: ['WEB'],
    userKind: ['STUDENT'],
    priority: 1,
    url: 'https://www.haw-hamburg.de/',
    imageUrl: null
}
run(
    'denies unauthenticated students and forged origins, verifies real magic-link admin identity',
    async () => {
        for (const path of [
            '/announcements',
            '/events',
            '/audit',
            '/permissions',
            '/status'
        ])
            expect((await request(path)).status).toBe(401)
        const student = await signIn('student@haw-hamburg.de')
        expect((await request('/announcements', student)).status).toBe(403)
        expect(
            (
                await request('/auth/request-link', undefined, 'POST', {
                    email: 'student@haw-hamburg.de'
                })
            ).status
        ).toBe(403)
        expect(
            (
                await request(
                    '/auth/request-link',
                    undefined,
                    'POST',
                    { email: 'maintainer@haw-hamburg.de' },
                    'https://evil.example'
                )
            ).status
        ).toBe(403)
        const admin = await signIn('maintainer@haw-hamburg.de')
        expect((await request('/auth/session', admin)).status).toBe(200)
    }
)
run(
    'persists announcement CRUD, detects stale updates and audits each committed change',
    async () => {
        const token = await signIn('maintainer@haw-hamburg.de')
        const created = await request(
            '/announcements',
            token,
            'POST',
            announcement
        )
        expect(created.status).toBe(200)
        const row = await created.json()
        expect(
            (await repo.list('announcements')).some((x) => x.id === row.id)
        ).toBe(true)
        const changed = await request(
            `/announcements/${row.id}`,
            token,
            'PATCH',
            {
                ...announcement,
                title: { de: 'Geändert', en: 'Changed' },
                version: row.version
            }
        )
        expect(changed.status).toBe(200)
        expect(
            (
                await request(`/announcements/${row.id}`, token, 'PATCH', {
                    ...announcement,
                    version: row.version
                })
            ).status
        ).toBe(409)
        const fresh = await changed.json()
        expect(
            (
                await request(`/announcements/${row.id}`, token, 'DELETE', {
                    version: fresh.version
                })
            ).status
        ).toBe(200)
        const audit = await repo.audit(100, 0)
        expect(
            audit.filter(
                (r) =>
                    String(r.entityId) === row.id &&
                    r.entity === 'app_announcements'
            )
        ).toHaveLength(3)
    }
)
run('rolls back content writes if the audit transaction fails', async () => {
    const before = (await repo.list('announcements')).length
    await pool.query(
        "CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit failure'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit()"
    )
    try {
        await expect(
            repo.write(
                'announcements',
                null,
                validateContent('announcements', announcement),
                undefined,
                { id: 'test', email: 'maintainer@haw-hamburg.de' }
            )
        ).rejects.toThrow()
        expect((await repo.list('announcements')).length).toBe(before)
    } finally {
        await pool.query(
            'DROP TRIGGER reject_audit ON audit_log; DROP FUNCTION reject_audit()'
        )
    }
})
run(
    'enforces delegated capabilities, immediate revocation, bootstrap protection and session expiry',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        const editor = await signIn('editor@haw-hamburg.de')
        expect(
            (
                await request('/permissions', admin, 'PUT', {
                    email: 'editor@haw-hamburg.de',
                    capabilities: ['events']
                })
            ).status
        ).toBe(200)
        expect((await request('/events', editor)).status).toBe(200)
        expect((await request('/audit', editor)).status).toBe(403)
        const event = await request('/events', editor, 'POST', {
            ...announcement,
            organizer: 'Test club',
            location: 'BT7'
        })
        expect(event.status).toBe(200)
        expect(
            (
                await request('/permissions', admin, 'PUT', {
                    email: 'editor@haw-hamburg.de',
                    capabilities: []
                })
            ).status
        ).toBe(200)
        expect((await request('/events', editor)).status).toBe(403)
        expect(
            (
                await request('/permissions', admin, 'PUT', {
                    email: 'maintainer@haw-hamburg.de',
                    capabilities: []
                })
            ).status
        ).toBe(403)
        await pool.query(
            'UPDATE haw_session SET "expiresAt"=now()-interval \'1 day\''
        )
        expect((await request('/auth/session', admin)).status).toBe(401)
    }
)

run(
    'protects the final delegated admin and exposes only bilingual public event fields',
    async () => {
        const actor = {
            id: 'fixture-admin',
            email: 'maintainer@haw-hamburg.de'
        }
        await repo.setPermissions('last-admin@haw-hamburg.de', ['admin'], actor)
        const withoutBootstrap = createAdminRepository(pool, [])
        await expect(
            withoutBootstrap.setPermissions(
                'last-admin@haw-hamburg.de',
                [],
                actor
            )
        ).rejects.toThrow('LastAdminProtected')
        const events = await publicClubEvents(
            pool,
            'en',
            new Date('2026-10-24T00:00:00Z')
        )
        expect(events.length).toBeGreaterThan(0)
        expect(events[0].origin).toBe('CLUB')
        expect(events[0].title).toBe('Test announcement')
        expect('privateLink' in events[0]).toBe(false)
        expect(
            (
                await publicClubEvents(
                    pool,
                    'de',
                    new Date('2026-10-24T00:00:00Z')
                )
            )[0].title
        ).toBe('Testankündigung')
    }
)
run('revokes the backend session on logout', async () => {
    const token = await signIn('maintainer@haw-hamburg.de')
    expect((await request('/auth/logout', token, 'POST', {})).status).toBe(200)
    expect((await request('/auth/session', token)).status).toBe(401)
})

run(
    'allows password login only for provisioned verified administrators without changing student login',
    async () => {
        const previousSession = await signIn('maintainer@haw-hamburg.de')
        const password = 'Isolated-admin-test-password-2026!'
        await setAdminPassword(
            pool,
            repo,
            'maintainer@haw-hamburg.de',
            password
        )
        expect((await request('/auth/session', previousSession)).status).toBe(
            401
        )
        const credentials = await pool.query(
            `SELECT password FROM haw_account WHERE "providerId"='credential' AND "userId"=(SELECT id FROM haw_user WHERE email=$1)`,
            ['maintainer@haw-hamburg.de']
        )
        expect(credentials.rows[0].password).not.toBe(password)
        expect(credentials.rows[0].password.length).toBeGreaterThan(32)
        const before = messages.size
        expect(
            (
                await request('/auth/password', undefined, 'POST', {
                    email: 'maintainer@haw-hamburg.de',
                    password: 'incorrect-password'
                })
            ).status
        ).toBe(401)
        expect(
            (
                await request('/auth/password', undefined, 'POST', {
                    email: 'student@haw-hamburg.de',
                    password
                })
            ).status
        ).toBe(401)
        const response = await request('/auth/password', undefined, 'POST', {
            email: 'maintainer@haw-hamburg.de',
            password
        })
        expect(response.status).toBe(200)
        const result = await response.json()
        expect((await request('/auth/session', result.token)).status).toBe(200)
        expect(messages.size).toBe(before)
        const publicAuth = createAccountAuth({
            pool,
            secret: 'isolated-test-secret-at-least-thirty-two-characters',
            baseURL: 'http://localhost:43128',
            webOrigin: origin
        })
        const studentAttempt = await publicAuth.handler(
            new Request('http://localhost/api/accounts/password', {
                method: 'POST',
                headers: { Origin: origin, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'maintainer@haw-hamburg.de',
                    password
                })
            })
        )
        expect(studentAttempt.status).toBe(404)
        await repo.setPermissions('unverified@haw-hamburg.de', ['events'], {
            id: 'test-operator',
            email: 'maintainer@haw-hamburg.de'
        })
        await pool.query(
            'INSERT INTO haw_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
            [
                crypto.randomUUID(),
                'Unverified fixture',
                'unverified@haw-hamburg.de'
            ]
        )
        await expect(
            setAdminPassword(pool, repo, 'unverified@haw-hamburg.de', password)
        ).rejects.toThrow('VerifiedAdminAccountRequired')
        for (let i = 0; i < 3; i++)
            await request('/auth/password', undefined, 'POST', {
                email: 'maintainer@haw-hamburg.de',
                password: 'incorrect-password'
            })
        expect(
            (
                await request('/auth/password', undefined, 'POST', {
                    email: 'maintainer@haw-hamburg.de',
                    password
                })
            ).status
        ).toBe(429)

        await expect(
            setAdminPassword(pool, repo, 'student@haw-hamburg.de', password)
        ).rejects.toThrow('AdminRequired')
        await expect(
            setAdminPassword(pool, repo, 'maintainer@haw-hamburg.de', 'short')
        ).rejects.toThrow('InvalidAdminPassword')
    }
)

run(
    'manages organiser profiles with authorization, version conflicts, audit and public metadata',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        const student = await signIn('ordinary@haw-hamburg.de')
        const body = {
            name: 'Profile Fixture',
            description: { de: 'Beschreibung', en: 'Description' },
            website: 'https://example.org',
            nonProfit: null
        }
        expect((await request('/organizers', undefined)).status).toBe(401)
        expect((await request('/organizers', student)).status).toBe(403)
        const created = await request('/organizers', admin, 'POST', body)
        expect(created.status).toBe(200)
        const profile = await created.json()
        expect(profile.version).toBeString()
        expect((await request('/organizers', admin, 'POST', body)).status).toBe(
            409
        )
        expect(
            (
                await request('/organizers', admin, 'POST', {
                    ...body,
                    version: profile.version,
                    location: 'BT7'
                })
            ).status
        ).toBe(200)
        expect(
            (
                await request('/organizers', admin, 'POST', {
                    ...body,
                    version: profile.version
                })
            ).status
        ).toBe(409)
        const published = await publicCampusLifeEvents(pool)
        expect(
            published.organizers.find((row) => row.id === profile.id)
                ?.description.en
        ).toBe('Description')
        expect(
            published.organizers.find((row) => row.id === profile.id)?.location
        ).toBe('BT7')
        expect(
            (
                await pool.query(
                    "SELECT count(*)::int AS n FROM audit_log WHERE entity='haw_organizer_profiles'"
                )
            ).rows[0].n
        ).toBe(2)
    }
)

run(
    'legal publications enforce admin access, draft privacy, conflict detection and withdrawal',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        await repo.setPermissions('legal-editor@haw-hamburg.de', ['events'], {
            id: 'test-operator',
            email: 'maintainer@haw-hamburg.de'
        })
        const editor = await signIn('legal-editor@haw-hamburg.de')
        expect((await request('/legal')).status).toBe(401)
        expect((await request('/legal', editor)).status).toBe(403)
        expect(
            (
                await request('/legal/privacy', editor, 'POST', {
                    action: 'save',
                    version: null,
                    draft: { mode: 'internal' }
                })
            ).status
        ).toBe(403)
        const publicRead = async () => {
            const response = await fetch(
                base.replace('/api/admin', '/api/legal')
            )
            expect(response.status).toBe(200)
            const value = await response.json()
            expect(JSON.stringify(value)).not.toContain('"draft"')
            return value as {
                key: string
                managed: boolean
                published: {
                    mode: string
                    body: { de: string; en: string }
                    url: { de: string; en: string }
                } | null
            }[]
        }
        expect(
            (await publicRead()).find((r) => r.key === 'privacy')?.managed
        ).toBe(false)
        const draft = {
            mode: 'internal',
            body: { de: 'Datenschutz Test', en: 'Privacy test' },
            url: { de: '', en: '' }
        }
        const save = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: null,
            draft
        })
        expect(save.status).toBe(200)
        let row = await save.json()
        expect(
            (await publicRead()).find((r) => r.key === 'privacy')?.published
        ).toBeNull()
        expect(
            (
                await request('/legal/privacy', admin, 'POST', {
                    action: 'publish',
                    version: null
                })
            ).status
        ).toBe(409)
        const publish = await request('/legal/privacy', admin, 'POST', {
            action: 'publish',
            version: row.version
        })
        expect(publish.status).toBe(200)
        row = await publish.json()
        expect(
            (await publicRead()).find((r) => r.key === 'privacy')?.published
                ?.body.en
        ).toBe('Privacy test')
        const edit = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: row.version,
            draft: {
                ...draft,
                body: { de: 'Unpublished DE', en: 'Unpublished EN' }
            }
        })
        expect(edit.status).toBe(200)
        row = await edit.json()
        expect(JSON.stringify(await publicRead())).not.toContain('Unpublished')
        const withdrawn = await request('/legal/privacy', admin, 'POST', {
            action: 'withdraw',
            version: row.version
        })
        expect(withdrawn.status).toBe(200)
        const privacy = (await publicRead()).find((r) => r.key === 'privacy')
        expect(privacy?.managed).toBe(true)
        expect(privacy?.published).toBeNull()
        expect(
            (
                await request('/legal/imprint', admin, 'POST', {
                    action: 'publish',
                    version: null
                })
            ).status
        ).toBe(400)
        const linked = await request('/legal/imprint', admin, 'POST', {
            action: 'save',
            version: null,
            draft: {
                mode: 'external',
                body: { de: 'Private scratchpad', en: 'Private scratchpad' },
                url: {
                    de: 'https://example.org/impressum',
                    en: 'https://example.org/imprint'
                }
            }
        })
        expect(linked.status).toBe(200)
        const imprint = await linked.json()
        expect(
            (
                await request('/legal/imprint', admin, 'POST', {
                    action: 'publish',
                    version: imprint.version
                })
            ).status
        ).toBe(200)
        const published = (await publicRead()).find(
            (r) => r.key === 'imprint'
        )?.published
        expect(published?.url.en).toBe('https://example.org/imprint')
        expect(published?.body.en).toBe('')
        expect(
            (
                await pool.query(
                    "SELECT count(*)::int AS n FROM audit_log WHERE entity='haw_legal_documents'"
                )
            ).rows[0].n
        ).toBe(6)
    }
)

run(
    'club editor enforces Ops authorization, setup, conflicts and audit-backed deletion',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        expect((await request('/clubs')).status).toBe(401)
        const setup = await request('/clubs', admin)
        expect(setup.status).toBe(503)
        expect((await setup.json()).error).toBe('ClubsSetupRequired')
        await pool.query(
            await readFile(
                new URL('../../db/accounts/clubs.sql', import.meta.url),
                'utf8'
            )
        )
        const empty = await request('/clubs', admin)
        expect(empty.status).toBe(200)
        expect(await empty.json()).toMatchObject({
            clubs: [],
            available: true,
            stale: false,
            updatedAt: null
        })
        await pool.query(
            "INSERT INTO haw_admin_roles(email,capabilities) VALUES('club-events@haw-hamburg.de',ARRAY['events'])"
        )
        const events = await signIn('club-events@haw-hamburg.de')
        const body = {
            language: 'de',
            title: 'Manual club',
            descriptionHtml: '<p>Welcome</p>',
            sourceUrl: 'https://example.org',
            links: [],
            version: null
        }
        expect((await request('/clubs', events, 'POST', body)).status).toBe(403)
        expect(
            (
                await request('/clubs', admin, 'POST', {
                    ...body,
                    sourceId: 'heading-new'
                })
            ).status
        ).toBe(400)
        const create = await request('/clubs', admin, 'POST', body)
        expect(create.status).toBe(200)
        const club = await create.json()
        expect(club.origin).toBe('manual')
        expect(
            (
                await request('/clubs', admin, 'POST', {
                    ...body,
                    editorId: club.editorId,
                    version: 'stale'
                })
            ).status
        ).toBe(409)
        expect(
            (
                await request(
                    `/clubs/${encodeURIComponent(club.editorId)}`,
                    events,
                    'DELETE',
                    { version: club.version }
                )
            ).status
        ).toBe(403)
        expect(
            (
                await request(
                    `/clubs/${encodeURIComponent(club.editorId)}`,
                    admin,
                    'DELETE',
                    { version: club.version }
                )
            ).status
        ).toBe(200)
    }
)

run(
    'rich legal JSON preserves versions, safe publication output and legacy literal text',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        const publicRead = async () => {
            const response = await fetch(
                base.replace('/api/admin', '/api/legal')
            )
            expect(response.status).toBe(200)
            return response.json() as Promise<
                {
                    key: string
                    published: {
                        body: { de: string; en: string }
                        bodyHtml?: { de: string; en: string }
                    } | null
                }[]
            >
        }
        const current = (await (await request('/legal', admin)).json()).find(
            (r: { key: string }) => r.key === 'privacy'
        )
        const auditBefore = (
            await pool.query(
                "SELECT count(*)::int AS n FROM audit_log WHERE entity='haw_legal_documents'"
            )
        ).rows[0].n
        const before = (
            await pool.query(
                "SELECT draft,version FROM haw_legal_documents WHERE document_key='privacy'"
            )
        ).rows[0]
        const rejected = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: current.version,
            draft: {
                mode: 'internal',
                bodyHtml: {
                    de: `<p>${'&'.repeat(5000)}</p>`,
                    en: '<p>English</p>'
                }
            }
        })
        expect(rejected.status).toBe(400)
        expect((await rejected.json()).error).toBe('InvalidInput')
        expect(
            (
                await pool.query(
                    "SELECT draft,version FROM haw_legal_documents WHERE document_key='privacy'"
                )
            ).rows[0]
        ).toEqual(before)
        expect(
            (
                await pool.query(
                    "SELECT count(*)::int AS n FROM audit_log WHERE entity='haw_legal_documents'"
                )
            ).rows[0].n
        ).toBe(auditBefore)
        const savedResponse = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: current.version,
            draft: {
                mode: 'internal',
                body: { de: 'Spoof', en: 'Spoof' },
                bodyHtml: {
                    de: '<h2>Datenschutz</h2><p><strong>Text</strong><img src="https://example.org/a"><script>evil()</script></p>',
                    en: '<p>Privacy <em>text</em></p>'
                }
            }
        })
        expect(savedResponse.status).toBe(200)
        const saved = await savedResponse.json()
        expect(saved.draft.body.de).toBe('Datenschutz\nText')
        expect(saved.draft.bodyHtml.de).not.toContain('<img')
        expect(
            (
                await request('/legal/privacy', admin, 'POST', {
                    action: 'publish',
                    version: current.version
                })
            ).status
        ).toBe(409)
        const publishedResponse = await request(
            '/legal/privacy',
            admin,
            'POST',
            { action: 'publish', version: saved.version }
        )
        expect(publishedResponse.status).toBe(200)
        const published = await publishedResponse.json()
        expect(
            (await publicRead()).find((r) => r.key === 'privacy')?.published
                ?.bodyHtml?.en
        ).toBe('<p>Privacy <em>text</em></p>')
        const draftResponse = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: published.version,
            draft: {
                mode: 'internal',
                bodyHtml: {
                    de: '<p>PRIVATE RICH DRAFT</p>',
                    en: '<p>PRIVATE RICH DRAFT</p>'
                }
            }
        })
        expect(draftResponse.status).toBe(200)
        expect(JSON.stringify(await publicRead())).not.toContain(
            'PRIVATE RICH DRAFT'
        )
        await pool.query(
            'UPDATE haw_legal_documents SET published=$1::jsonb WHERE document_key=$2',
            [
                JSON.stringify({
                    mode: 'internal',
                    body: { de: 'spoof', en: 'spoof' },
                    bodyHtml: {
                        de: '<p>Safe<script>unsafe()</script><img src="https://example.org/a"></p>',
                        en: '<p>Safe</p>'
                    },
                    url: { de: '', en: '' }
                }),
                'privacy'
            ]
        )
        const sanitized = (await publicRead()).find(
            (r) => r.key === 'privacy'
        )?.published
        expect(sanitized?.body.de).toBe('Safe')
        expect(sanitized?.bodyHtml?.de).toBe('<p>Safe</p>')
        await pool.query(
            'UPDATE haw_legal_documents SET published=$1::jsonb WHERE document_key=$2',
            [
                JSON.stringify({
                    mode: 'external',
                    body: { de: 'Hidden', en: 'Hidden' },
                    bodyHtml: { de: '<p>Hidden</p>', en: '<p>Hidden</p>' },
                    url: {
                        de: 'https://example.org/de',
                        en: 'https://example.org/en'
                    }
                }),
                'privacy'
            ]
        )
        const external = (await publicRead()).find(
            (r) => r.key === 'privacy'
        )?.published
        expect(external?.body).toEqual({ de: '', en: '' })
        expect(external).not.toHaveProperty('bodyHtml')
        const latest = await draftResponse.json()
        const plainSave = await request('/legal/privacy', admin, 'POST', {
            action: 'save',
            version: latest.version,
            draft: {
                mode: 'internal',
                body: {
                    de: 'a < b <strong>literal</strong>',
                    en: '<p>Literal plaintext</p>'
                }
            }
        })
        const plainRow = await plainSave.json()
        expect(
            (
                await request('/legal/privacy', admin, 'POST', {
                    action: 'publish',
                    version: plainRow.version
                })
            ).status
        ).toBe(200)
        expect(
            (await publicRead()).find((r) => r.key === 'privacy')?.published
                ?.body.de
        ).toBe('a < b <strong>literal</strong>')
    }
)

run(
    'quick links enforce permissions, conflicts, visibility and transactional audit',
    async () => {
        const admin = await signIn('maintainer@haw-hamburg.de')
        const student = await signIn('quick-student@haw-hamburg.de')
        const publicUrl = base.replace('/api/admin', '/api/quick-links')
        expect((await request('/quick-links')).status).toBe(401)
        expect((await request('/quick-links', student)).status).toBe(403)
        expect((await (await fetch(publicUrl)).json()).managed).toBe(false)
        const links = [
            {
                key: 'moodle',
                title: { de: 'Moodle', en: 'Moodle' },
                url: {
                    de: 'https://example.org/de',
                    en: 'https://example.org/en'
                },
                icon: 'FolderOpen',
                visible: true
            },
            {
                key: 'hidden',
                title: { de: 'Versteckt', en: 'Hidden' },
                url: {
                    de: 'https://example.org/de',
                    en: 'https://example.org/en'
                },
                icon: 'Link',
                visible: false
            }
        ]
        const created = await request('/quick-links', admin, 'POST', {
            links,
            version: null
        })
        expect(created.status).toBe(200)
        const saved = await created.json()
        expect(
            (await (await fetch(publicUrl)).json()).links.map(
                (v: { key: string }) => v.key
            )
        ).toEqual(['moodle'])
        expect(
            (
                await request('/quick-links', admin, 'POST', {
                    links: [],
                    version: null
                })
            ).status
        ).toBe(409)
        expect(
            (
                await request('/quick-links', admin, 'POST', {
                    links: [{ ...links[0], icon: 'invalid' }],
                    version: saved.version
                })
            ).status
        ).toBe(400)
        expect(
            (await (await request('/quick-links', admin)).json()).version
        ).toBe(saved.version)
        const empty = await request('/quick-links', admin, 'POST', {
            links: [],
            version: saved.version
        })
        expect(empty.status).toBe(200)
        const publicEmpty = await (await fetch(publicUrl)).json()
        expect(publicEmpty.managed).toBe(true)
        expect(publicEmpty.links).toEqual([])
        expect(
            (
                await pool.query(
                    "SELECT count(*)::int AS n FROM audit_log WHERE entity='haw_quick_links'"
                )
            ).rows[0].n
        ).toBe(2)
    }
)
