import express from 'express'
import type { AccountAuthService } from '@/lib/account-auth'
import { hawClubs } from '@/utils/haw-clubs'
import { legalKey } from './legal'
import { validateOrganizer } from './organizers'
import {
    adminEmail,
    type Capability,
    capabilities,
    requireCapability
} from './policy'
import type { AdminRepository } from './repository'
import { type ContentKind, validateContent } from './validation'
import { toWebRequest } from './web-request'
export interface AdminDependencies {
    origin: string
    auth: AccountAuthService
    repository: AdminRepository
    status: () => Promise<unknown>
}
export function createAdminRouter(deps: AdminDependencies | null) {
    const router = express.Router()
    const rates = new Map<string, { count: number; until: number }>()
    router.use((req, res, next) => {
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        })
        if (!deps) {
            res.status(503).json({ error: 'AdminNotConfigured' })
            return
        }
        if (req.headers.origin !== deps.origin) {
            res.status(403).json({ error: 'OriginNotAllowed' })
            return
        }
        const now = Date.now()
        for (const [key, v] of rates) if (v.until <= now) rates.delete(key)
        const ip = req.ip ?? 'unknown'
        const entry = rates.get(ip) ?? { count: 0, until: now + 60000 }
        if (entry.count >= 120 || (!rates.has(ip) && rates.size >= 1000)) {
            res.status(429).json({ error: 'TooManyRequests' })
            return
        }
        entry.count++
        rates.set(ip, entry)
        next()
    })
    router.use(express.json({ limit: '128kb' }))
    router.use(async (req, res) => {
        if (!deps) return
        try {
            const path = req.path
            if (path === '/auth/request-link' && req.method === 'POST') {
                const email = adminEmail(
                    typeof req.body?.email === 'string' ? req.body.email : ''
                )
                if (!(await deps.repository.grants(email)).length) {
                    res.status(403).json({ error: 'Forbidden' })
                    return
                }
                const request = toWebRequest(req, deps.origin, 'request-link', {
                    email
                })
                const response = await deps.auth.handler(request)
                res.status(response.status).json(await response.json())
                return
            }
            if (path === '/auth/password' && req.method === 'POST') {
                let email: string
                try {
                    email = adminEmail(
                        typeof req.body?.email === 'string'
                            ? req.body.email
                            : ''
                    )
                } catch {
                    res.status(401).json({ error: 'InvalidCredentials' })
                    return
                }
                if (!(await deps.repository.grants(email)).length) {
                    res.status(401).json({ error: 'InvalidCredentials' })
                    return
                }
                const response = await deps.auth.handler(
                    toWebRequest(req, deps.origin, 'password', {
                        email,
                        password: req.body?.password
                    })
                )
                const value = (await response.json()) as {
                    token?: string
                    user?: { id: string; email: string }
                }
                if (!response.ok || !value.token || !value.user) {
                    res.status(response.status === 429 ? 429 : 401).json({
                        error:
                            response.status === 429
                                ? 'TooManyRequests'
                                : 'InvalidCredentials'
                    })
                    return
                }
                const grants = await deps.repository.grants(value.user.email)
                if (!grants.length) {
                    await deps.auth.handler(
                        toWebRequest(
                            req,
                            deps.origin,
                            'sign-out',
                            {},
                            value.token
                        )
                    )
                    res.status(401).json({ error: 'InvalidCredentials' })
                    return
                }
                res.json({ token: value.token })
                return
            }
            if (path === '/auth/confirm' && req.method === 'POST') {
                const response = await deps.auth.handler(
                    toWebRequest(req, deps.origin, 'confirm', {
                        token: req.body?.token
                    })
                )
                const value = (await response.json()) as {
                    token?: string
                    user?: { id: string; email: string }
                }
                if (!response.ok || !value.token || !value.user) {
                    res.status(400).json({ error: 'InvalidLink' })
                    return
                }
                const grants = await deps.repository.grants(value.user.email)
                if (!grants.length) {
                    await deps.auth.handler(
                        toWebRequest(
                            req,
                            deps.origin,
                            'sign-out',
                            {},
                            value.token
                        )
                    )
                    res.status(403).json({ error: 'Forbidden' })
                    return
                }
                res.json({
                    token: value.token,
                    user: {
                        id: value.user.id,
                        email: value.user.email,
                        name: value.user.email.split('@')[0],
                        capabilities: grants
                    }
                })
                return
            }
            const header = req.headers.authorization
            if (!header?.startsWith('Bearer ')) {
                res.status(401).json({ error: 'SignInRequired' })
                return
            }
            // Identity is verified by Better Auth on every request; caller claims never select a user.
            const headers = new Headers({ Authorization: header })
            const session = await deps.auth.session(headers)
            if (!session || !session.user.emailVerified) {
                res.status(401).json({ error: 'SignInRequired' })
                return
            }
            const grants = await deps.repository.grants(session.user.email)
            if (!grants.length) {
                res.status(403).json({ error: 'Forbidden' })
                return
            }
            const actor = {
                id: session.user.id,
                email: adminEmail(session.user.email)
            }
            if (path === '/auth/session' && req.method === 'GET') {
                res.json({
                    user: {
                        ...actor,
                        name: actor.email.split('@')[0],
                        capabilities: grants
                    },
                    expiresAt: session.session.expiresAt
                })
                return
            }
            if (path === '/auth/logout' && req.method === 'POST') {
                await deps.auth.handler(
                    toWebRequest(
                        req,
                        deps.origin,
                        'sign-out',
                        {},
                        header.slice(7)
                    )
                )
                res.json({ ok: true })
                return
            }
            if (path === '/organizers') {
                requireCapability(grants, 'events')
                if (req.method === 'GET') {
                    res.json(await deps.repository.organizers.list())
                    return
                }
                if (req.method === 'POST') {
                    res.json(
                        await deps.repository.organizers.save(
                            validateOrganizer(req.body),
                            typeof req.body.version === 'string'
                                ? req.body.version
                                : null,
                            actor
                        )
                    )
                    return
                }
            }
            if (path === '/legal' && req.method === 'GET') {
                requireCapability(grants, 'admin')
                res.json(await deps.repository.legal.list())
                return
            }
            const legalMatch = /^\/legal\/(privacy|imprint)$/.exec(path)
            if (legalMatch && req.method === 'POST') {
                requireCapability(grants, 'admin')
                const action = req.body?.action
                const version = req.body?.version
                if (
                    !['save', 'publish', 'withdraw'].includes(action) ||
                    (version !== null && typeof version !== 'string')
                )
                    throw Error('InvalidInput')
                res.json(
                    await deps.repository.legal.write(
                        legalKey(legalMatch[1]),
                        action,
                        req.body?.draft,
                        version,
                        actor
                    )
                )
                return
            }
            if (path === '/clubs' && req.method === 'GET') {
                requireCapability(grants, 'ops')
                res.json(
                    await hawClubs(req.query.language === 'en' ? 'en' : 'de')
                )
                return
            }
            if (path === '/status' && req.method === 'GET') {
                requireCapability(grants, 'ops')
                res.json(await deps.status())
                return
            }
            if (path === '/audit' && req.method === 'GET') {
                requireCapability(grants, 'audit')
                const limit = Number(req.query.limit ?? 100)
                const offset = Number(req.query.offset ?? 0)
                if (
                    !Number.isInteger(limit) ||
                    limit < 1 ||
                    limit > 200 ||
                    !Number.isInteger(offset) ||
                    offset < 0 ||
                    offset > 100000
                )
                    throw Error('InvalidInput')
                res.json(await deps.repository.audit(limit, offset))
                return
            }
            if (path === '/permissions') {
                requireCapability(grants, 'admin')
                if (req.method === 'GET') {
                    res.json(await deps.repository.permissions())
                    return
                }
                if (req.method === 'PUT') {
                    const email = adminEmail(req.body?.email ?? '')
                    const roles = req.body?.capabilities
                    if (
                        !Array.isArray(roles) ||
                        roles.length > capabilities.length ||
                        roles.some(
                            (c: unknown) =>
                                !capabilities.includes(c as Capability)
                        )
                    )
                        throw Error('InvalidInput')
                    await deps.repository.setPermissions(
                        email,
                        [...new Set(roles)] as Capability[],
                        actor
                    )
                    res.json({ ok: true })
                    return
                }
            }
            const match = /^\/(announcements|events)(?:\/([1-9]\d*))?$/.exec(
                path
            )
            if (match) {
                const kind = match[1] as ContentKind
                requireCapability(grants, kind)
                const id = match[2] ? Number(match[2]) : null
                if (id !== null && !Number.isSafeInteger(id))
                    throw Error('InvalidInput')
                if (req.method === 'GET' && id === null) {
                    res.json(await deps.repository.list(kind))
                    return
                }
                if (
                    (req.method === 'POST' && id === null) ||
                    (req.method === 'PATCH' && id !== null)
                ) {
                    res.json(
                        await deps.repository.write(
                            kind,
                            id,
                            validateContent(kind, req.body),
                            typeof req.body.version === 'string'
                                ? req.body.version
                                : undefined,
                            actor
                        )
                    )
                    return
                }
                if (req.method === 'DELETE' && id !== null) {
                    await deps.repository.remove(
                        kind,
                        id,
                        typeof req.body?.version === 'string'
                            ? req.body.version
                            : undefined,
                        actor
                    )
                    res.json({ ok: true })
                    return
                }
            }
            res.status(404).json({ error: 'NotFound' })
        } catch (e) {
            const code = e instanceof Error ? e.message : ''
            const status =
                code === 'Forbidden' ||
                code === 'BootstrapProtected' ||
                code === 'LastAdminProtected'
                    ? 403
                    : code === 'Conflict'
                      ? 409
                      : code === 'NotFound'
                        ? 404
                        : code === 'InvalidInput' ||
                            code === 'InvalidAdminEmail'
                          ? 400
                          : 503
            res.status(status).json({
                error: status === 503 ? 'AdminUnavailable' : code
            })
        }
    })
    router.use(
        (
            _error: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction
        ) => {
            res.status(400).json({ error: 'InvalidInput' })
        }
    )
    return router
}
