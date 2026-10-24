import express from 'express'
import type { Pool } from 'pg'
import { createLegalRepository } from '@/admin/legal'
export function createPublicLegalRouter(pool: Pool | null) {
    const router = express.Router()
    router.get('/', async (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        })
        if (!pool) {
            res.status(503).json({ error: 'LegalUnavailable' })
            return
        }
        try {
            res.json(await createLegalRepository(pool).publicList())
        } catch {
            res.status(503).json({ error: 'LegalUnavailable' })
        }
    })
    return router
}
