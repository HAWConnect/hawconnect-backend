import { load } from 'cheerio'
export interface HamburgRecord {
    date: string
    location: string
    sourceId: string
    title: string
    category: string
    allergens: string[] | null
    additives: string[] | null
    symbols: string[] | null
    declaredFlags?: string[]
    prices: {
        student: number | null
        employee: number | null
        guest: number | null
    }
}
export interface HamburgMenuSnapshot {
    language: 'de' | 'en'
    records: HamburgRecord[]
    locations: string[]
    dates: string[]
}
const splitCodes = (value: string | undefined) =>
    value === undefined
        ? null
        : value.trim().split(/\s+/).filter(Boolean).sort()
const restaurants: Record<string, string> = {
    '168': 'BergedorfMensa',
    '170': 'BerlinerTorMensa',
    '164': 'FinkenauMensa'
}
export function parseHamburgMenu(
    html: string,
    language: 'de' | 'en'
): HamburgMenuSnapshot {
    const $ = load(html)
    const sections = $('[data-location-id]')
    if (!sections.length) throw new Error('Food source structure changed')
    const records = new Map<string, HamburgRecord>()
    const locations = new Set<string>()
    const dates = new Set<string>()
    sections.each((_, section) => {
        const location = $(section).attr('data-location-id') ?? ''
        locations.add(location)
        $(section)
            .find('[data-timestamp]')
            .each((_, day) => {
                const date = $(day).attr('data-timestamp') ?? ''
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                    throw new Error('Invalid menu date')
                dates.add(date)
                $(day)
                    .find('.menue-tile')
                    .each((_, tile) => {
                        const el = $(tile)
                        const sourceId = el.attr('data-uid') ?? ''
                        const title = el
                            .find('.singlemeal__headline')
                            .first()
                            .text()
                            .replace(/\s+/g, ' ')
                            .trim()
                        if (!sourceId || !title)
                            throw new Error('Invalid menu record')
                        const prices: HamburgRecord['prices'] = {
                            student: null,
                            employee: null,
                            guest: null
                        }
                        el.find('dd.dlist__item').each((_, price) => {
                            const text = $(price)
                                .text()
                                .replace(/\s+/g, ' ')
                                .trim()
                            const numeric = $(price)
                                .find('.singlemeal__info--semibold')
                                .first()
                                .text()
                                .match(/(\d+(?:[,.]\d{1,2})?)\s*€/)
                            if (!numeric) return
                            const value = Number(numeric[1].replace(',', '.'))
                            if (/Studierende|Students/i.test(text))
                                prices.student = value
                            else if (/Bedienstete|Employees/i.test(text))
                                prices.employee = value
                            else if (/Gäste|Guests/i.test(text))
                                prices.guest = value
                        })
                        const record = {
                            date,
                            location,
                            sourceId,
                            title,
                            category:
                                el.attr('data-categories')?.trim() ??
                                el
                                    .closest('.menulist__categorywrapper')
                                    .find('.menulist__categorytitle')
                                    .first()
                                    .text()
                                    .trim(),
                            allergens: splitCodes(el.attr('data-allergens')),
                            additives: splitCodes(el.attr('data-additives')),
                            symbols: splitCodes(el.attr('data-symbols')),
                            declaredFlags: [
                                ...new Set(
                                    el
                                        .find('img[src]')
                                        .toArray()
                                        .flatMap((image) => {
                                            const filename = (
                                                $(image).attr('src') ?? ''
                                            )
                                                .split('?')[0]
                                                .split('/')
                                                .pop()
                                            const flag = (
                                                {
                                                    'beef.svg': 'R',
                                                    'pork.svg': 'S',
                                                    'alc.svg': 'A'
                                                } as Record<string, string>
                                            )[filename ?? '']
                                            return flag ? [flag] : []
                                        })
                                )
                            ],
                            prices
                        }
                        records.set(`${location}:${date}:${sourceId}`, record)
                    })
            })
    })
    if (!dates.size || !records.size)
        throw new Error('Unverified empty menu source')
    return {
        language,
        records: [...records.values()],
        locations: [...locations],
        dates: [...dates]
    }
}
export function mergeHamburgMenus(
    de: HamburgMenuSnapshot,
    en: HamburgMenuSnapshot,
    verifiedPairs: Readonly<Record<string, string>> = {}
) {
    const primary = de.records.length ? de : en
    const days = new Map<string, ReturnType<typeof makeMeal>[]>()
    let translationFallback = false
    function makeMeal(r: HamburgRecord, translation?: HamburgRecord) {
        const flags =
            r.symbols?.flatMap((s) =>
                s === '38'
                    ? ['veg']
                    : s === '31'
                      ? ['V']
                      : s === '17'
                        ? ['F']
                        : s === '45'
                          ? ['favorite']
                          : []
            ) ?? null
        return {
            id: `hamburg:${r.location}:${r.date}:${r.sourceId}`,
            mealId: `hamburg:${r.location}:${r.sourceId}`,
            name: { de: r.title, en: translation?.title ?? r.title },
            category: r.category,
            prices: r.prices,
            allergens: r.allergens,
            additives: r.additives,
            flags: r.declaredFlags?.length
                ? [...new Set([...(flags ?? []), ...r.declaredFlags])]
                : flags,
            nutrition: null,
            variants: [],
            originalLanguage: primary.language,
            static: false,
            restaurant: restaurants[r.location] ?? `Hamburg_${r.location}`,
            parent: null
        }
    }
    for (const r of primary.records) {
        const verifiedId =
            verifiedPairs[`${r.location}:${r.date}:${r.sourceId}`]
        const match = verifiedId
            ? en.records.find(
                  (e) =>
                      e.sourceId === verifiedId &&
                      e.date === r.date &&
                      e.location === r.location
              )
            : undefined
        if (!match) translationFallback = true
        const meal = makeMeal(r, match)
        days.set(r.date, [...(days.get(r.date) ?? []), meal])
    }
    return {
        foodData: [...days]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([timestamp, meals]) => ({ timestamp, meals })),
        translationFallback,
        errors: [] as { location: string; message: string }[]
    }
}
