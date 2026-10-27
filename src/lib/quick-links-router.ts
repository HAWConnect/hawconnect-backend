import express from 'express'
import type { Pool } from 'pg'
import { createQuickLinksRepository } from '@/admin/quick-links'
export function createPublicQuickLinksRouter(pool: Pool | null) {
    const router = express.Router()
    router.get('/', async (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        })
        try {
            if (!pool) throw Error('Unavailable')
            res.json(await createQuickLinksRepository(pool).read(true))
        } catch {
            res.status(503).json({ error: 'QuickLinksUnavailable' })
        }
    })
    return router
}
