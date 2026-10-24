import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { getMigrations } from 'better-auth/db/migration'
import { Pool } from 'pg'
import { createAccountAuth } from '../../lib/account-auth'

const databaseURL = process.env.HAWCONNECT_TEST_DATABASE_URL
const suite = databaseURL ? describe : describe.skip
suite('passwordless account integration (isolated PostgreSQL)', () => {
    const pool = new Pool({ connectionString: databaseURL })
    const sent: { email: string; url: string }[] = []
    const clientIP = crypto.randomUUID()
    const service = createAccountAuth({
        pool,
        secret: 'test-only-secret-with-at-least-thirty-two-characters',
        baseURL: 'http://localhost:4000',
        webOrigin: 'http://localhost:3001',
        send: async (message) => {
            sent.push(message)
        }
    })
    const request = (path: string, body?: unknown, cookie?: string) =>
        service.handler(
            new Request(`http://localhost:4000/api/accounts/${path}`, {
                method: body ? 'POST' : 'GET',
                headers: {
                    Origin: 'http://localhost:3001',
                    'x-hawconnect-client-ip': clientIP,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(cookie ? { cookie } : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            })
        )
    beforeAll(async () => {
        const migration = await getMigrations(service.auth.options)
        await migration.runMigrations()
    })
    afterAll(async () => {
        await pool.end()
    })
    it('does not send a link to a non-university mailbox', async () => {
        const response = await request('request-link', {
            email: 'a@example.com'
        })
        expect(response.status).toBe(400)
        expect(sent).toHaveLength(0)
    })
    it('requires explicit redemption, creates a session, and rejects token replay', async () => {
        const email = `flow-${crypto.randomUUID()}@haw-hamburg.de`
        expect((await request('request-link', { email })).status).toBe(200)
        const link = new URL(sent.at(-1)?.url)
        expect(link.origin).toBe('http://localhost:3001')
        expect(link.search).toBe('')
        const token = new URLSearchParams(link.hash.slice(1)).get('token')!
        expect((await request('confirm')).status).toBe(405)
        const confirmed = await request('confirm', { token })
        expect(confirmed.status).toBe(200)
        const result = (await confirmed.json()) as {
            user: { email: string }
            token?: string
        }
        expect(result.user.email).toBe(email)
        expect(result.token).toBeUndefined()
        const cookies = confirmed.headers
            .getSetCookie()
            .map((s) => s.split(';')[0])
            .join('; ')
        expect((await request('session', undefined, cookies)).status).toBe(200)
        expect((await request('confirm', { token })).status).toBe(400)
        expect((await request('session')).status).toBe(401)
    })
    it('fails honestly when delivery is unavailable', async () => {
        const unavailable = createAccountAuth({
            pool,
            secret: 'test-only-secret-with-at-least-thirty-two-characters',
            baseURL: 'http://localhost:4000',
            webOrigin: 'http://localhost:3001'
        })
        const response = await unavailable.handler(
            new Request('http://localhost:4000/api/accounts/request-link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://localhost:3001'
                },
                body: JSON.stringify({ email: 'a@haw-hamburg.de' })
            })
        )
        expect(response.status).toBe(503)
        expect(await response.text()).not.toContain('token')
    })
    it('limits repeated delivery requests per mailbox', async () => {
        const email = `limit-${crypto.randomUUID()}@haw-hamburg.de`
        for (let i = 0; i < 3; i++)
            expect((await request('request-link', { email })).status).toBe(200)
        expect((await request('request-link', { email })).status).toBe(429)
    })
    it('stores opaque verification identifiers and rejects expired links', async () => {
        const email = `expiry-${crypto.randomUUID()}@haw-hamburg.de`
        await request('request-link', { email })
        const token = new URLSearchParams(
            new URL(sent.at(-1)?.url).hash.slice(1)
        ).get('token')!
        const rows = await pool.query(
            'SELECT identifier FROM haw_verification WHERE value LIKE $1',
            [`%${email}%`]
        )
        expect(rows.rows).toHaveLength(1)
        expect(rows.rows[0].identifier).not.toContain(token)
        await pool.query(
            'UPDATE haw_verification SET "expiresAt" = $1 WHERE value LIKE $2',
            [new Date(Date.now() - 1000), `%${email}%`]
        )
        expect((await request('confirm', { token })).status).toBe(400)
    })
    it('allows only one of two concurrent redemption attempts', async () => {
        const email = `race-${crypto.randomUUID()}@haw-hamburg.de`
        await request('request-link', { email })
        const token = new URLSearchParams(
            new URL(sent.at(-1)?.url).hash.slice(1)
        ).get('token')!
        const results = await Promise.all([
            request('confirm', { token }),
            request('confirm', { token })
        ])
        expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    })
    it('does not allow arbitrary callback origins', async () => {
        const result = await service.handler(
            new Request('http://localhost:4000/api/accounts/request-link', {
                method: 'POST',
                headers: {
                    Origin: 'https://evil.test',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: 'a@haw-hamburg.de' })
            })
        )
        expect(result.status).toBe(403)
    })
    it('stores native bearer credentials only in a native confirmation response', async () => {
        const email = `native-${crypto.randomUUID()}@haw-hamburg.de`
        await request('request-link', { email })
        const last = sent.at(-1)
        if (!last) throw new Error('NoTestMail')
        const token = new URLSearchParams(new URL(last.url).hash.slice(1)).get(
            'token'
        )
        const confirmed = await service.handler(
            new Request('http://localhost:4000/api/accounts/confirm', {
                method: 'POST',
                headers: {
                    Origin: 'hawconnect://',
                    'Content-Type': 'application/json',
                    'X-HAWConnect-Client': 'native',
                    'x-hawconnect-client-ip': crypto.randomUUID()
                },
                body: JSON.stringify({ token })
            })
        )
        expect(confirmed.status).toBe(200)
        const data = (await confirmed.json()) as { token: string }
        expect(typeof data.token).toBe('string')
        const headers = {
            Origin: 'hawconnect://',
            'Content-Type': 'application/json',
            'X-HAWConnect-Client': 'native',
            Authorization: 'Bearer ' + data.token
        }
        expect(
            (
                await service.handler(
                    new Request('http://localhost:4000/api/accounts/session', {
                        headers
                    })
                )
            ).status
        ).toBe(200)
        expect(
            (
                await service.handler(
                    new Request(
                        'http://localhost:4000/api/accounts/revoke-all',
                        { method: 'POST', headers, body: '{}' }
                    )
                )
            ).status
        ).toBe(200)
        expect(
            (
                await service.handler(
                    new Request('http://localhost:4000/api/accounts/session', {
                        headers
                    })
                )
            ).status
        ).toBe(401)
    })
})
