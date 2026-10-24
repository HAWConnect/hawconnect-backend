import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
    academicSources,
    mergeAcademicCalendars,
    parseAcademicCalendar
} from '@/scraping/academic-calendar'

type Semesters = ReturnType<typeof mergeAcademicCalendars>
interface Snapshot {
    semesters: Semesters
    updatedAt: string
}
const refreshMs = 86400000
export function createAcademicCalendarService(deps: {
    fetch: () => Promise<Semesters>
    read: () => Promise<unknown>
    write: (s: Snapshot) => Promise<void>
    now: () => Date
}) {
    let snapshot: Snapshot | null = null
    let loaded = false
    let failed = false
    let inFlight: Promise<void> | null = null
    const load = async () => {
        if (loaded) return
        loaded = true
        try {
            const stored = (await deps.read()) as Snapshot
            if (
                Array.isArray(stored?.semesters) &&
                stored.semesters.length &&
                Number.isFinite(Date.parse(stored.updatedAt))
            )
                snapshot = stored
        } catch {
            /* First run has no cache. */
        }
    }
    const refresh = (): Promise<void> => {
        if (inFlight) return inFlight
        inFlight = (async () => {
            await load()
            try {
                const semesters = await deps.fetch()
                if (!semesters.length) throw Error('Empty academic calendar')
                const candidate = {
                    semesters,
                    updatedAt: deps.now().toISOString()
                }
                await deps.write(candidate)
                snapshot = candidate
                failed = false
            } catch {
                failed = true
                console.warn(
                    'HAW academic calendar refresh failed; retaining validated cache'
                )
            }
        })().finally(() => {
            inFlight = null
        })
        return inFlight
    }
    const get = async () => {
        await load()
        if (!snapshot) await refresh()
        return {
            semesters: snapshot?.semesters ?? [],
            updatedAt: snapshot?.updatedAt ?? null,
            available: snapshot !== null,
            stale:
                failed ||
                !snapshot ||
                deps.now().getTime() - Date.parse(snapshot.updatedAt) >
                    refreshMs
        }
    }
    return { get, refresh }
}
async function source(language: 'de' | 'en') {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(academicSources[language], {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent':
                        'HAWConnect/0.1 (student-maintained campus project)'
                }
            })
            if (!response.ok) throw Error('Academic calendar unavailable')
            const html = await response.text()
            if (html.length > 3000000)
                throw Error('Academic calendar too large')
            return parseAcademicCalendar(html)
        } catch {
            if (attempt === 1) throw Error('Academic calendar unavailable')
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
    throw Error('Academic calendar unavailable')
}
const cachePath = path.resolve(
    process.env.HAWCONNECT_ACADEMIC_CALENDAR_PATH ??
        '.cache/haw-academic-calendar.json'
)
export const academicCalendarService = createAcademicCalendarService({
    fetch: async () => {
        const [de, en] = await Promise.all([source('de'), source('en')])
        return mergeAcademicCalendars(de, en)
    },
    read: async () => JSON.parse(await readFile(cachePath, 'utf8')),
    write: async (snapshot) => {
        await mkdir(path.dirname(cachePath), { recursive: true })
        await writeFile(`${cachePath}.tmp`, JSON.stringify(snapshot))
        await rename(`${cachePath}.tmp`, cachePath)
    },
    now: () => new Date()
})
export function startAcademicCalendarRefresh() {
    void academicCalendarService.refresh()
    const timer = setInterval(
        () => void academicCalendarService.refresh(),
        refreshMs
    )
    timer.unref()
    return () => clearInterval(timer)
}
