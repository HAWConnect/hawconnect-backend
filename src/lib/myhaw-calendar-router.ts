import express from 'express'
import { fetchMyHawCalendar, validateMyHawUrl } from '@/utils/myhaw-calendar'

export function createMyHawCalendarRouter(download = fetchMyHawCalendar) {
    const myHawCalendarRouter = express.Router()
    const clients = new Map<string, { count: number; until: number }>()
    let active = 0
    myHawCalendarRouter.use((_req, res, next) => {
        res.set({
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
            'X-Content-Type-Options': 'nosniff'
        })
        next()
    })
    myHawCalendarRouter.post(
        '/',
        (req, res, next) => {
            const now = Date.now()
            for (const [key, value] of clients)
                if (value.until <= now) clients.delete(key)
            const key = req.ip ?? 'unknown'
            const entry = clients.get(key) ?? { count: 0, until: now + 60000 }
            if (
                entry.count >= 10 ||
                active >= 8 ||
                (!clients.has(key) && clients.size >= 1000)
            ) {
                res.status(429).json({ error: 'CalendarRateLimited' })
                return
            }
            entry.count++
            clients.set(key, entry)
            next()
        },
        express.json({ limit: '8kb' }),
        async (req, res) => {
            try {
                validateMyHawUrl(
                    typeof req.body?.url === 'string' ? req.body.url : ''
                )
            } catch {
                res.status(400).json({ error: 'InvalidCalendarLink' })
                return
            }
            if (active >= 8) {
                res.status(429).json({ error: 'CalendarRateLimited' })
                return
            }
            active++
            try {
                const text = await download(req.body.url)
                res.type('text/calendar').send(text)
            } catch {
                res.status(502).json({ error: 'CalendarDownloadFailed' })
            } finally {
                active--
            }
        }
    )
    // Never echo a request body, URL or framework parser error.
    myHawCalendarRouter.use(
        (
            _error: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction
        ) => {
            res.status(400).json({ error: 'InvalidCalendarRequest' })
        }
    )

    return myHawCalendarRouter
}
export const myHawCalendarRouter = createMyHawCalendarRouter()
