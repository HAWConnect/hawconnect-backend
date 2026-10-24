import { expect, test } from 'bun:test'
import {
    berlinEventTime,
    mergeHawEventPages,
    parseHawEvents
} from '../haw-events'

const page = (date = 'Sa., 24.10.2026', time = '10:00 – 16:00 Uhr') =>
    `<div class="news_table"><table><tbody><tr><td class="date">${date}</td><td class="time">${time}</td><td class="title"><a href="/detail/news/news/show/test-event/">Official event</a></td><td class="address">Berliner Tor 5</td></tr></tbody></table></div>`
test('parses official events, stable links and Berlin time across daylight saving', () => {
    const a = parseHawEvents(page()).events[0]
    expect(a.startTime).toBe('2026-10-24T08:00:00.000Z')
    expect(a.endTime).toBe('2026-10-24T14:00:00.000Z')
    expect(berlinEventTime('2026-10-26', '10:00')).toBe(
        '2026-10-26T09:00:00.000Z'
    )
    expect(a.location).toBe('Berliner Tor 5')
    expect(a.id).toBe('/detail/news/news/show/test-event/')
})
test('preserves unknown end times and multi-day ranges, rejects invalid source data', () => {
    const a = parseHawEvents(
        page('Fr., 30.10.2026 - Fr., 13.11.2026', '09:30 Uhr')
    ).events[0]
    expect(a.endDate).toBe('2026-11-13')
    expect(a.endTime).toBeNull()
    expect(
        parseHawEvents(page('26.11.2026', '19:00 – 00:00 Uhr')).events[0]
            .endTime
    ).toBeNull()
    expect(() => parseHawEvents(page('31.02.2026'))).toThrow()
    expect(() => parseHawEvents('<html>Service unavailable</html>')).toThrow()
    expect(() =>
        parseHawEvents(
            page().replace(
                '/detail/news/news/show/test-event/',
                'javascript:alert(1)'
            )
        )
    ).toThrow()
})
test('deduplicates linked events and restricts pagination to the official source', () => {
    const html = `${page()}<div class="page-navigation"><li class="next"><a href="/hochschule/veranstaltungen/page-2/">next</a></li></div>`
    const a = parseHawEvents(html)
    expect(a.next).toBe(
        'https://www.haw-hamburg.de/hochschule/veranstaltungen/page-2/'
    )
    expect(mergeHawEventPages([a, a])).toHaveLength(1)
    expect(() =>
        parseHawEvents(
            html.replace(
                '/hochschule/veranstaltungen/page-2/',
                'https://example.com/'
            )
        )
    ).toThrow()
})

test('bounds page fetching, deduplicates and preserves good cached events after failures', async () => {
    const { fetchHawEventPages, createHawEventsService } = await import(
        '../../utils/haw-events'
    )
    const payload = await fetchHawEventPages(
        async () =>
            `${page()}<div class="page-navigation"><li class="next"><a href="/hochschule/veranstaltungen/page-2/">next</a></li></div>`,
        1
    )
    expect(payload.truncated).toBe(true)
    let disk: unknown = null
    let fail = false
    const deps = {
        fetch: async () => {
            if (fail) throw Error('offline')
            return payload
        },
        read: async () => disk,
        write: async (s: unknown) => {
            disk = s
        },
        now: () => new Date('2026-10-24T08:00:00Z')
    }
    const service = createHawEventsService(deps)
    await service.refresh()
    fail = true
    await service.refresh()
    expect((await service.get()).events).toHaveLength(1)
    expect((await service.get()).stale).toBe(true)
    expect((await createHawEventsService(deps).get()).available).toBe(true)
})

test('parses the actual HAW listing including its external organizer link', async () => {
    const html = await Bun.file(
        new URL('../fixtures/haw-events.html', import.meta.url)
    ).text()
    const result = parseHawEvents(html)
    expect(result.events).toHaveLength(10)
    expect(
        result.events.some((e) =>
            e.sourceUrl.startsWith('https://www.maritimes-cluster.de/')
        )
    ).toBe(true)
    expect(
        result.events.find((e) => e.title.startsWith('Teaching in English'))
            ?.endDate
    ).toBe('2026-11-13')
})

test('rejects corrupt cached records and limits cold-start failure retries', async () => {
    const { createHawEventsService } = await import('../../utils/haw-events')
    let attempts = 0
    let now = new Date('2026-10-24T08:00:00Z')
    const service = createHawEventsService({
        read: async () => ({
            events: [null],
            truncated: false,
            updatedAt: now.toISOString()
        }),
        write: async () => {},
        fetch: async () => {
            attempts++
            throw Error('offline')
        },
        now: () => now
    })
    expect((await service.get()).available).toBe(false)
    await service.get()
    await service.get()
    expect(attempts).toBe(1)
    now = new Date(now.getTime() + 60000)
    await service.get()
    expect(attempts).toBe(2)
})
