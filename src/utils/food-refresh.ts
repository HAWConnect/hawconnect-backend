import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mergeHamburgMenus, parseHamburgMenu } from '@/scraping/hamburg'

type Payload = ReturnType<typeof mergeHamburgMenus> & {
    englishFoodData?: ReturnType<typeof mergeHamburgMenus>['foodData']
}
interface Snapshot extends Payload {
    updatedAt: string
}
interface Dependencies {
    fetchSnapshot: () => Promise<Payload>
    read: () => Promise<unknown>
    write: (value: Snapshot) => Promise<void>
    now: () => Date
}
export function createFoodService(deps: Dependencies) {
    let snapshot: Snapshot | null = null
    let stale = true
    let loaded = false
    let inFlight: Promise<void> | null = null
    const load = async () => {
        if (loaded) return
        loaded = true
        try {
            const value = (await deps.read()) as Snapshot | null
            if (
                value &&
                Array.isArray(value.foodData) &&
                typeof value.updatedAt === 'string'
            )
                snapshot = value
        } catch {
            /* An absent snapshot is an explicit unavailable state. */
        }
    }
    const refresh = (): Promise<void> => {
        if (inFlight) return inFlight
        inFlight = (async () => {
            await load()
            try {
                const candidate = {
                    ...(await deps.fetchSnapshot()),
                    updatedAt: deps.now().toISOString()
                }
                await deps.write(candidate)
                snapshot = candidate
                stale = false
            } catch {
                stale = true
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
            ...(snapshot ?? {
                foodData: [],
                englishFoodData: undefined,
                errors: [],
                translationFallback: false,
                updatedAt: null
            }),
            available: snapshot !== null,
            stale:
                stale ||
                !snapshot ||
                deps.now().getTime() - Date.parse(snapshot.updatedAt) > 1800000
        }
    }
    return { refresh, get }
}
async function fetchSource(
    language: 'de' | 'en',
    week: 'this_week' | 'next_week'
) {
    const url =
        language === 'de'
            ? `https://www.stwhh.de/speiseplan?t=${week}`
            : `https://www.stwhh.de/en/menu?t=${week}`
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent':
                        'HAWConnect/0.1 (+student-maintained campus project)'
                }
            })
            if (!response.ok) throw Error('Food source unavailable')
            const html = await response.text()
            if (html.length > 10_000_000) throw Error('Food source too large')
            return parseHamburgMenu(html, language)
        } catch {
            if (attempt === 1) throw Error('Food source unavailable')
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
    throw Error('Food source unavailable')
}

export function combineFoodWeeks(current: Payload, next: Payload): Payload {
    const days = new Map<
        string,
        Map<string, Payload['foodData'][number]['meals'][number]>
    >()
    for (const day of [...current.foodData, ...next.foodData]) {
        const meals = days.get(day.timestamp) ?? new Map()
        for (const meal of day.meals) meals.set(meal.id, meal)
        days.set(day.timestamp, meals)
    }
    return {
        foodData: [...days]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([timestamp, meals]) => ({
                timestamp,
                meals: [...meals.values()]
            })),
        englishFoodData:
            current.englishFoodData && next.englishFoodData
                ? combineFoodWeeks(
                      {
                          foodData: current.englishFoodData,
                          translationFallback: false,
                          errors: []
                      },
                      {
                          foodData: next.englishFoodData,
                          translationFallback: false,
                          errors: []
                      }
                  ).foodData
                : current.englishFoodData,
        translationFallback:
            current.translationFallback || next.translationFallback,
        errors: [...current.errors, ...next.errors]
    }
}

const snapshotPath = path.resolve(
    process.env.HAWCONNECT_FOOD_SNAPSHOT_PATH ?? '.cache/hamburg-food.json'
)
export const hamburgFoodService = createFoodService({
    fetchSnapshot: async () => {
        const loadWeek = async (week: 'this_week' | 'next_week') => {
            const [de, en] = await Promise.all([
                fetchSource('de', week),
                fetchSource('en', week)
            ])
            if (
                de.locations.sort().join() !== en.locations.sort().join() ||
                de.dates.sort().join() !== en.dates.sort().join()
            )
                throw Error('Partial source response')
            return {
                ...mergeHamburgMenus(de, en),
                englishFoodData: mergeHamburgMenus({ ...de, records: [] }, en)
                    .foodData
            }
        }
        const current = await loadWeek('this_week')
        try {
            return combineFoodWeeks(current, await loadWeek('next_week'))
        } catch {
            return {
                ...current,
                errors: [
                    ...current.errors,
                    {
                        location: 'Hamburg',
                        message:
                            'Next-week menu unavailable; current-week data retained'
                    }
                ]
            }
        }
    },
    read: async () => JSON.parse(await readFile(snapshotPath, 'utf8')),
    write: async (snapshot) => {
        await mkdir(path.dirname(snapshotPath), { recursive: true })
        await writeFile(`${snapshotPath}.tmp`, JSON.stringify(snapshot))
        await rename(`${snapshotPath}.tmp`, snapshotPath)
    },
    now: () => new Date()
})
export function startFoodRefresh() {
    void hamburgFoodService.refresh()
    const interval = Number(process.env.HAWCONNECT_FOOD_REFRESH_MS ?? 1800000)
    const timer = setInterval(
        () => void hamburgFoodService.refresh(),
        Math.max(300000, Number.isFinite(interval) ? interval : 1800000)
    )
    timer.unref()
    return () => clearInterval(timer)
}
