import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import {
    HAW_CLUBS_SOURCES,
    type HawClub,
    parseHawClubs
} from '@/scraping/haw-clubs'

interface Snapshot {
    updatedAt: string
    de: HawClub[]
    en: HawClub[]
}
const cache = '.cache/haw-clubs.json'
const interval = 86400000
let snapshot: Snapshot | null = null
let pending: Promise<void> | null = null
let nextAttempt = 0
export async function hawClubs(language = 'de') {
    const locale = language === 'en' ? 'en' : 'de'
    if (!snapshot) {
        try {
            const value = JSON.parse(await readFile(cache, 'utf8')) as Snapshot
            if (
                Number.isFinite(Date.parse(value.updatedAt)) &&
                ['de', 'en'].every(
                    (key) =>
                        Array.isArray(value[key as 'de' | 'en']) &&
                        value[key as 'de' | 'en'].length >= 3
                )
            )
                snapshot = value
        } catch {
            /* No valid disk cache yet. */
        }
    }
    if (
        (!snapshot ||
            Date.now() - Date.parse(snapshot.updatedAt) >= interval) &&
        Date.now() >= nextAttempt
    ) {
        if (!pending)
            pending = (async () => {
                nextAttempt = Date.now() + 300000
                try {
                    const pages = await Promise.all(
                        (['de', 'en'] as const).map(async (key) => {
                            const response = await fetch(
                                HAW_CLUBS_SOURCES[key],
                                {
                                    signal: AbortSignal.timeout(15000),
                                    redirect: 'error'
                                }
                            )
                            if (!response.ok) throw Error('HawClubsUnavailable')
                            const html = await response.text()
                            if (html.length > 2000000)
                                throw Error('HawClubsSourceTooLarge')
                            return parseHawClubs(html, key)
                        })
                    )
                    const value = {
                        updatedAt: new Date().toISOString(),
                        de: pages[0],
                        en: pages[1]
                    }
                    await mkdir('.cache', { recursive: true })
                    const temporary = `${cache}.${crypto.randomUUID()}.tmp`
                    await writeFile(temporary, JSON.stringify(value))
                    await rename(temporary, cache)
                    snapshot = value
                    nextAttempt = Date.now() + interval
                } catch {
                    console.warn(
                        'HAW clubs refresh unavailable; retaining cached directory'
                    )
                }
            })().finally(() => {
                pending = null
            })
        await pending
    }
    return {
        clubs: snapshot?.[locale] ?? [],
        available: !!snapshot,
        stale:
            !snapshot ||
            Date.now() - Date.parse(snapshot.updatedAt) >= interval,
        updatedAt: snapshot?.updatedAt ?? null,
        sourceUrl: HAW_CLUBS_SOURCES[locale]
    }
}
