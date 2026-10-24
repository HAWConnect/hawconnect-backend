import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
    HAW_EVENTS_SOURCE,
    type HawEvent,
    mergeHawEventPages,
    parseHawEvents
} from '@/scraping/haw-events'

interface Payload {
    events: HawEvent[]
    truncated: boolean
}
interface Snapshot extends Payload {
    updatedAt: string
}
function validEvent(event: unknown): event is HawEvent {
    if (!event || typeof event !== 'object') return false
    const e = event as HawEvent
    const date = (value: unknown) =>
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value))
    const time = (value: unknown) =>
        value === null ||
        (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    try {
        const url = new URL(e.sourceUrl)
        return (
            typeof e.id === 'string' &&
            !!e.id &&
            typeof e.title === 'string' &&
            !!e.title &&
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            date(e.date) &&
            (e.endDate === null || date(e.endDate)) &&
            typeof e.dateLabel === 'string' &&
            (e.timeLabel === null || typeof e.timeLabel === 'string') &&
            (e.location === null || typeof e.location === 'string') &&
            time(e.startTime) &&
            time(e.endTime)
        )
    } catch {
        return false
    }
}
const refreshMs = 3600000
export function createHawEventsService(deps: {
    fetch: () => Promise<Payload>
    read: () => Promise<unknown>
    write: (s: Snapshot) => Promise<void>
    now: () => Date
}) {
    let snapshot: Snapshot | null = null
    let loaded = false
    let failed = false
    let pending: Promise<void> | null = null
    let nextReadAttempt = 0
    const load = async () => {
        if (loaded) return
        loaded = true
        try {
            const value = (await deps.read()) as Snapshot
            if (
                Array.isArray(value?.events) &&
                typeof value.truncated === 'boolean' &&
                Number.isFinite(Date.parse(value.updatedAt)) &&
                value.events.every(validEvent)
            )
                snapshot = value
        } catch {
            /* First run has no cache. */
        }
    }
    const refresh = (): Promise<void> => {
        if (pending) return pending
        pending = (async () => {
            await load()
            nextReadAttempt = deps.now().getTime() + 60000
            try {
                const candidate = {
                    ...(await deps.fetch()),
                    updatedAt: deps.now().toISOString()
                }
                await deps.write(candidate)
                snapshot = candidate
                failed = false
            } catch {
                failed = true
                console.warn(
                    'HAW events refresh failed; retaining validated cache'
                )
            }
        })().finally(() => {
            pending = null
        })
        return pending
    }
    const get = async () => {
        await load()
        if (!snapshot && deps.now().getTime() >= nextReadAttempt)
            await refresh()
        const now = deps.now()
        const today = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Europe/Berlin',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(now)
        return {
            events: (snapshot?.events ?? []).filter((e) =>
                e.endTime
                    ? Date.parse(e.endTime) >= now.getTime()
                    : (e.endDate ?? e.date) >= today
            ),
            updatedAt: snapshot?.updatedAt ?? null,
            truncated: snapshot?.truncated ?? false,
            available: snapshot !== null,
            stale:
                failed ||
                !snapshot ||
                now.getTime() - Date.parse(snapshot.updatedAt) > refreshMs,
            sourceUrl: HAW_EVENTS_SOURCE
        }
    }
    return { get, refresh }
}
async function fetchHtml(url: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent':
                        'HAWConnect/0.1 (student-maintained campus project)'
                }
            })
            if (!response.ok) throw Error('HAW event source unavailable')
            const html = await response.text()
            if (html.length > 2000000) throw Error('HAW event source too large')
            return html
        } catch {
            if (attempt === 1) throw Error('HAW event source unavailable')
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
    throw Error('HAW event source unavailable')
}
export async function fetchHawEventPages(
    fetchPage = fetchHtml,
    maxPages = 8
): Promise<Payload> {
    const pages: ReturnType<typeof parseHawEvents>[] = []
    const visited = new Set<string>()
    let next: string | null = HAW_EVENTS_SOURCE
    while (next && pages.length < maxPages) {
        if (visited.has(next)) throw Error('Repeated HAW event pagination')
        visited.add(next)
        const page = parseHawEvents(await fetchPage(next))
        pages.push(page)
        next = page.next
        if (next && pages.length < maxPages)
            await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return { events: mergeHawEventPages(pages), truncated: next !== null }
}
const cachePath = path.resolve(
    process.env.HAWCONNECT_EVENTS_SNAPSHOT_PATH ?? '.cache/haw-events.json'
)
export const hawEventsService = createHawEventsService({
    fetch: () => fetchHawEventPages(),
    read: async () => JSON.parse(await readFile(cachePath, 'utf8')),
    write: async (s) => {
        await mkdir(path.dirname(cachePath), { recursive: true })
        await writeFile(`${cachePath}.tmp`, JSON.stringify(s))
        await rename(`${cachePath}.tmp`, cachePath)
    },
    now: () => new Date()
})
export function startHawEventsRefresh() {
    void hawEventsService.refresh()
    const timer = setInterval(() => void hawEventsService.refresh(), refreshMs)
    timer.unref()
    return () => clearInterval(timer)
}
