import { load } from 'cheerio'

export const academicSources = {
    de: 'https://www.haw-hamburg.de/international/erasmus-gaststudierende/akademischer-kalender/',
    en: 'https://www.haw-hamburg.de/en/international/erasmus-study-abroad/academic-calendar/'
}
const months: Record<string, number> = {
    januar: 1,
    january: 1,
    februar: 2,
    february: 2,
    märz: 3,
    march: 3,
    april: 4,
    mai: 5,
    may: 5,
    juni: 6,
    june: 6,
    juli: 7,
    july: 7,
    august: 8,
    september: 9,
    oktober: 10,
    october: 10,
    november: 11,
    dezember: 12,
    december: 12
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
export function parseAcademicDate(value: string) {
    const parts = clean(value).split(/\s*[-–—]\s*/)
    if (parts.length > 2) throw Error('Unsupported academic date range')
    const parse = (s: string) => {
        const m = /^(\d{1,2})\.?\s*([a-zäöü]+)?\s*(\d{4})?$/i.exec(s)
        if (!m) throw Error('Invalid academic date')
        return {
            day: Number(m[1]),
            month: m[2] ? months[m[2].toLowerCase()] : undefined,
            year: m[3] ? Number(m[3]) : undefined
        }
    }
    const first = parse(parts[0])
    const last = parse(parts.at(-1)!)
    const iso = (p: typeof first, fallback: typeof first) => {
        const year = p.year ?? fallback.year
        const month = p.month ?? fallback.month
        if (!year || !month) throw Error('Incomplete academic date')
        const date = new Date(Date.UTC(year, month - 1, p.day))
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== p.day
        )
            throw Error('Invalid academic date')
        return date.toISOString().slice(0, 10)
    }
    const begin = iso(first, last)
    const end = parts.length === 2 ? iso(last, first) : null
    if (end && end < begin) throw Error('Reversed academic date range')
    return { begin, end }
}
export function parseAcademicCalendar(html: string) {
    const $ = load(html)
    const semesters: {
        key: string
        name: string
        events: {
            id: string
            name: string
            begin: string
            end: string | null
        }[]
    }[] = []
    $('h4').each((_, heading) => {
        const name = clean($(heading).text())
        const match =
            /^(Sommersemester|Wintersemester|Summer semester|Winter semester)\s+(\d{4}(?:\/\d{2})?)$/i.exec(
                name
            )
        if (!match) return
        const key = `${/sommer|summer/i.test(match[1]) ? 'summer' : 'winter'}-${match[2]}`
        const events: (typeof semesters)[number]['events'] = []
        $(heading)
            .closest('.card')
            .find('table tr')
            .each((_, row) => {
                const cells = $(row).find('td')
                if (cells.length !== 2)
                    throw Error('Academic calendar table changed')
                const date = parseAcademicDate(clean(cells.eq(0).text()))
                const title = clean(cells.eq(1).text()).replace(/\*+$/, '')
                if (!title) throw Error('Missing academic event name')
                const id = `haw-academic:${key}:${date.begin}:${date.end ?? date.begin}`
                if (events.some((e) => e.id === id))
                    throw Error('Ambiguous academic event dates')
                events.push({ id, name: title, ...date })
            })
        if (!events.length) throw Error('Empty academic semester')
        semesters.push({ key, name, events })
    })
    if (!semesters.length) throw Error('Academic calendar structure changed')
    return semesters
}
export function mergeAcademicCalendars(
    de: ReturnType<typeof parseAcademicCalendar>,
    en: ReturnType<typeof parseAcademicCalendar>
) {
    if (de.length !== en.length)
        throw Error('Academic calendar languages differ')
    return de.map((term) => {
        const english = en.find((t) => t.key === term.key)
        if (!english || english.events.length !== term.events.length)
            throw Error('Academic calendar languages differ')
        return {
            key: term.key,
            name: { de: term.name, en: english.name },
            events: term.events.map((event) => {
                const translation = english.events.find(
                    (e) => e.id === event.id
                )
                if (!translation) throw Error('Academic calendar dates differ')
                return {
                    ...event,
                    hasHours: false,
                    name: { de: event.name, en: translation.name }
                }
            })
        }
    })
}
