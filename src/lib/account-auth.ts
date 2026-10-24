import { createHash } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { bearer, magicLink } from 'better-auth/plugins'
import type { Pool } from 'pg'
import { normaliseAccountEmail } from '@/utils/account-policy'

export interface AccountMail {
    email: string
    url: string
}
interface AccountAuthConfig {
    pool: Pool
    secret: string
    baseURL: string
    webOrigin: string
    passwordLogin?: boolean
    send?: (message: AccountMail) => Promise<void>
}
const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

export function createAccountAuth(config: AccountAuthConfig) {
    if (config.secret.length < 32) throw new Error('AccountSecretRequired')
    const webOrigin = new URL(config.webOrigin).origin
    const auth = betterAuth({
        appName: 'HAWConnect',
        baseURL: config.baseURL,
        secret: config.secret,
        database: config.pool,
        telemetry: { enabled: false },
        logger: { disabled: true },
        trustedOrigins: [webOrigin, 'hawconnect://'],
        emailAndPassword: {
            enabled: config.passwordLogin === true,
            disableSignUp: true,
            requireEmailVerification: true,
            minPasswordLength: 12,
            maxPasswordLength: 128
        },
        user: { modelName: 'haw_user', deleteUser: { enabled: true } },
        account: { modelName: 'haw_account' },
        verification: { modelName: 'haw_verification' },
        session: {
            modelName: 'haw_session',
            expiresIn: 60 * 60 * 24 * 30,
            updateAge: 60 * 60 * 24,
            cookieCache: { enabled: false }
        },
        rateLimit: {
            enabled: false,
            storage: 'database',
            modelName: 'haw_rate_limit',
            window: 60,
            max: 20
        },
        advanced: {
            cookiePrefix: 'hawconnect',
            useSecureCookies: new URL(config.baseURL).protocol === 'https:',
            trustedProxyHeaders: false
        },
        databaseHooks: {
            user: {
                create: {
                    before: async (user) => ({
                        data: {
                            ...user,
                            email: normaliseAccountEmail(user.email)
                        }
                    })
                },
                update: {
                    before: async (user) =>
                        user.email
                            ? {
                                  data: {
                                      ...user,
                                      email: normaliseAccountEmail(user.email)
                                  }
                              }
                            : undefined
                }
            }
        },
        plugins: [
            bearer(),
            magicLink({
                expiresIn: 600,
                storeToken: 'hashed',
                sendMagicLink: async ({ email, token }) => {
                    const address = normaliseAccountEmail(email)
                    if (!config.send) throw new Error('MailUnavailable')
                    const landing = new URL('/auth-confirm', webOrigin)
                    landing.hash = new URLSearchParams({ token }).toString()
                    await config.send({
                        email: address,
                        url: landing.toString()
                    })
                }
            })
        ]
    })
    async function limited(key: string, max: number): Promise<boolean> {
        const digest = createHash('sha256').update(key).digest('hex')
        const now = Date.now()
        const result = await config.pool.query(
            `INSERT INTO haw_rate_limit (id, key, count, "lastRequest") VALUES ($1,$2,1,$3)
            ON CONFLICT (key) DO UPDATE SET count = CASE WHEN haw_rate_limit."lastRequest" < $3 - 60000 THEN 1 ELSE haw_rate_limit.count + 1 END,
            "lastRequest" = CASE WHEN haw_rate_limit."lastRequest" < $3 - 60000 THEN $3 ELSE haw_rate_limit."lastRequest" END RETURNING count`,
            [crypto.randomUUID(), `account:${digest}`, now]
        )
        return Number(result.rows[0].count) > max
    }
    async function bodyOf(request: Request): Promise<Record<string, unknown>> {
        if (
            !request.headers.get('content-type')?.startsWith('application/json')
        )
            throw new Error('InvalidInput')
        const reader = request.body?.getReader()
        if (!reader) throw new Error('InvalidInput')
        let size = 0
        let text = ''
        const decoder = new TextDecoder()
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 4096) {
                await reader.cancel()
                throw new Error('InvalidInput')
            }
            text += decoder.decode(value, { stream: true })
        }
        const value = JSON.parse(text + decoder.decode())
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('InvalidInput')
        return value
    }
    async function session(headers: Headers) {
        const value = await auth.api.getSession({
            headers,
            query: { disableRefresh: true }
        })
        if (!value) return null
        try {
            normaliseAccountEmail(value.user.email)
        } catch {
            return null
        }
        return value
    }
    async function handler(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname.split('/').at(-1)
        if (path === 'password' && !config.passwordLogin)
            return json({ error: 'NotFound' }, 404)
        const native = request.headers.get('x-hawconnect-client') === 'native'
        const origin = request.headers.get('origin')
        if (
            origin &&
            origin !== webOrigin &&
            !(native && origin === 'hawconnect://')
        )
            return json({ error: 'OriginNotAllowed' }, 403)
        if (request.method === 'GET' && path === 'session') {
            try {
                const response = await auth.handler(
                    new Request(
                        new URL('/api/auth/get-session', config.baseURL),
                        { headers: request.headers }
                    )
                )
                if (!response.ok)
                    return json({ error: 'AccountUnavailable' }, 503)
                const value = (await response.json()) as {
                    user?: { id: string; email: string }
                    session?: { expiresAt: string }
                } | null
                if (!value?.user || !value.session)
                    return json({ error: 'SignInRequired' }, 401)
                normaliseAccountEmail(value.user.email)
                const output = json({
                    user: { id: value.user.id, email: value.user.email },
                    expiresAt: value.session.expiresAt
                })
                for (const cookie of response.headers.getSetCookie())
                    output.headers.append('Set-Cookie', cookie)
                return output
            } catch {
                return json({ error: 'AccountUnavailable' }, 503)
            }
        }
        if (request.method !== 'POST')
            return json({ error: 'MethodNotAllowed' }, 405)
        if (!origin) return json({ error: 'OriginRequired' }, 403)
        if (
            ![
                'request-link',
                'password',
                'confirm',
                'sign-out',
                'revoke-all',
                'delete-account'
            ].includes(path ?? '')
        )
            return json({ error: 'NotFound' }, 404)
        try {
            const body = await bodyOf(request)
            const ip =
                request.headers.get('x-hawconnect-client-ip') ?? 'unknown'
            if (await limited(`ip:${ip}`, 20))
                return json({ error: 'TooManyRequests' }, 429)
            if (path === 'password') {
                let email: string
                try {
                    email = normaliseAccountEmail(
                        typeof body.email === 'string' ? body.email : ''
                    )
                } catch {
                    return json({ error: 'InvalidCredentials' }, 401)
                }
                if (
                    typeof body.password !== 'string' ||
                    body.password.length < 12 ||
                    body.password.length > 128
                )
                    return json({ error: 'InvalidCredentials' }, 401)
                if (await limited(`password:${email}`, 5))
                    return json({ error: 'TooManyRequests' }, 429)
                try {
                    const response = await auth.handler(
                        new Request(
                            new URL('/api/auth/sign-in/email', config.baseURL),
                            {
                                method: 'POST',
                                headers: request.headers,
                                body: JSON.stringify({
                                    email,
                                    password: body.password
                                })
                            }
                        )
                    )
                    if (!response.ok)
                        return json({ error: 'InvalidCredentials' }, 401)
                    const value = (await response.json()) as {
                        token?: string
                        user?: {
                            id: string
                            email: string
                            emailVerified: boolean
                        }
                    }
                    if (!value.token || !value.user?.emailVerified)
                        return json({ error: 'InvalidCredentials' }, 401)
                    return json({
                        user: { id: value.user.id, email: value.user.email },
                        ...(native ? { token: value.token } : {})
                    })
                } catch {
                    return json({ error: 'InvalidCredentials' }, 401)
                }
            }
            if (path === 'request-link') {
                let email: string
                try {
                    email = normaliseAccountEmail(
                        typeof body.email === 'string' ? body.email : ''
                    )
                } catch {
                    return json({ error: 'InvalidAccountEmail' }, 400)
                }
                if (!config.send) return json({ error: 'MailUnavailable' }, 503)
                if (await limited(`email:${email}`, 3))
                    return json({ error: 'TooManyRequests' }, 429)
                try {
                    await auth.api.signInMagicLink({
                        body: { email },
                        headers: request.headers
                    })
                    return json({ status: 'sent' })
                } catch {
                    return json({ error: 'MailUnavailable' }, 503)
                }
            }
            if (path === 'confirm') {
                if (
                    typeof body.token !== 'string' ||
                    body.token.length < 16 ||
                    body.token.length > 512
                )
                    return json({ error: 'InvalidLink' }, 400)
                const internal = new URL(
                    '/api/auth/magic-link/verify',
                    config.baseURL
                )
                internal.searchParams.set('token', body.token)
                const response = await auth.handler(
                    new Request(internal, { headers: request.headers })
                )
                if (!response.ok) return json({ error: 'InvalidLink' }, 400)
                const data = (await response.json()) as {
                    user?: { id: string; email: string }
                    token?: string
                }
                if (!data.user) return json({ error: 'InvalidLink' }, 400)
                const output = json({
                    user: { id: data.user.id, email: data.user.email },
                    ...(native ? { token: data.token } : {})
                })
                for (const cookie of response.headers.getSetCookie())
                    output.headers.append('Set-Cookie', cookie)
                return output
            }
            const authenticated = await session(request.headers)
            if (!authenticated) return json({ error: 'SignInRequired' }, 401)
            const expected = request.headers.get('x-hawconnect-account')
            if (expected && expected !== authenticated.user.id)
                return json({ error: 'AccountChanged' }, 409)
            const endpoint =
                path === 'sign-out'
                    ? 'sign-out'
                    : path === 'delete-account'
                      ? 'delete-user'
                      : 'revoke-sessions'
            return await auth.handler(
                new Request(new URL(`/api/auth/${endpoint}`, config.baseURL), {
                    method: 'POST',
                    headers: request.headers,
                    body: '{}'
                })
            )
        } catch {
            return json({ error: 'AccountUnavailable' }, 503)
        }
    }
    return { auth, handler, session }
}
export type AccountAuthService = ReturnType<typeof createAccountAuth>

/** Bind a browser request to the account the client believes is active; never select ownership from this header. */
export async function getAccountOwner(
    service: AccountAuthService,
    headers: Headers
): Promise<string | undefined> {
    const expected = headers.get('x-hawconnect-account')
    if (!expected) return undefined
    const session = await service.session(headers)
    return session?.user.id === expected ? session.user.id : undefined
}
