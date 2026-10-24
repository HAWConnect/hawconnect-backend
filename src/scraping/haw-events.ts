import { load } from 'cheerio'
export const HAW_EVENTS_SOURCE =
    'https://www.haw-hamburg.de/hochschule/veranstaltungen/'
export interface HawEvent {
    id: string
    title: string
    sourceUrl: string
    date: string
    endDate: string | null
    dateLabel: string
    timeLabel: string | null
    startTime: string | null
    endTime: string | null
    location: string | null
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
function isoDate(value: string) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
    if (!m) throw Error('Invalid HAW event date')
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const date = new Date(Date.UTC(y, mo - 1, d))
    if (
        date.getUTCDate() !== d ||
        date.getUTCMonth() !== mo - 1 ||
        date.getUTCFullYear() !== y
    )
        throw Error('Invalid HAW event date')
    return date.toISOString().slice(0, 10)
}
export function berlinEventTime(date: string, time: string) {
    const [year, month, day] = date.split('-').map(Number)
    const [hour, minute] = time.split(':').map(Number)
    if (hour > 23 || minute > 59) throw Error('Invalid HAW event time')
    const wall = Date.UTC(year, month - 1, day, hour, minute)
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Berlin',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    })
    const parts = (ms: number) =>
        Object.fromEntries(
            formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value])
        )
    const observed = parts(wall)
    const offset =
        Date.UTC(
            Number(observed.year),
            Number(observed.month) - 1,
            Number(observed.day),
            Number(observed.hour),
            Number(observed.minute)
        ) - wall
    const result = wall - offset
    const check = parts(result)
    if (
        `${check.year}-${check.month}-${check.day}` !== date ||
        `${check.hour}:${check.minute}` !== time
    )
        throw Error('Invalid local HAW event time')
    return new Date(result).toISOString()
}
export function parseHawEvents(html: string) {
    const $ = load(html)
    const table = $('.news_table table').first()
    if (!table.length) throw Error('HAW event listing structure changed')
    const events: HawEvent[] = []
    table.find('tbody tr').each((_, row) => {
        const el = $(row)
        const title = clean(el.find('td.title').text())
        const href = el.find('td.title a[href]').attr('href')
        const dateLabel = clean(el.find('td.date').text())
        const dates = dateLabel.match(/\d{2}\.\d{2}\.\d{4}/g)
        if (!href || !title || !dates?.length || dates.length > 2)
            throw Error('Invalid HAW event row')
        const url = new URL(href, HAW_EVENTS_SOURCE)
        if (
            url.protocol !== 'https:' ||
            Boolean(url.username) ||
            Boolean(url.password)
        )
            throw Error('Unexpected HAW event source')
        const date = isoDate(dates[0])
        const endDate = dates[1] ? isoDate(dates[1]) : null
        if (endDate && endDate < date) throw Error('Reversed HAW event range')
        const timeLabel = clean(el.find('td.time').text()) || null
        const times = timeLabel?.match(/\d{2}:\d{2}/g) ?? []
        if (
            times.length > 2 ||
            (timeLabel &&
                !times.length &&
                !/ganztägig|all.day/i.test(timeLabel))
        )
            throw Error('Unsupported HAW event time')
        const startTime = times[0] ? berlinEventTime(date, times[0]) : null
        let endTime = times[1]
            ? berlinEventTime(endDate ?? date, times[1])
            : null
        // An overnight range without an explicit end date is kept as source text.
        if (startTime && endTime && endTime < startTime) endTime = null
        if (url.origin === 'https://www.haw-hamburg.de') url.search = ''
        url.hash = ''
        events.push({
            id:
                url.origin === 'https://www.haw-hamburg.de'
                    ? url.pathname
                    : url.href,
            title,
            sourceUrl: url.href,
            date,
            endDate,
            dateLabel,
            timeLabel,
            startTime,
            endTime,
            location: clean(el.find('td.address').text()) || null
        })
    })
    if (
        !events.length &&
        !/keine veranstaltungen|no events/i.test($('.news').text())
    )
        throw Error('Unverified empty HAW event listing')
    const nextHref = $('.page-navigation li.next a[href]').first().attr('href')
    let next: string | null = null
    if (nextHref) {
        const url = new URL(nextHref, HAW_EVENTS_SOURCE)
        if (
            url.origin !== 'https://www.haw-hamburg.de' ||
            !/^\/hochschule\/veranstaltungen\/page-\d+\/$/.test(url.pathname)
        )
            throw Error('Unexpected HAW event pagination')
        next = url.origin + url.pathname
    }
    return { events, next }
}
export function mergeHawEventPages(pages: ReturnType<typeof parseHawEvents>[]) {
    const events = new Map<string, HawEvent>()
    for (const page of pages)
        for (const event of page.events)
            if (!events.has(event.id)) events.set(event.id, event)
    return [...events.values()].sort((a, b) =>
        (a.startTime ?? a.date).localeCompare(b.startTime ?? b.date)
    )
}
