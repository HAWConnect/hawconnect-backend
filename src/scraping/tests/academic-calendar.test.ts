import { expect, test } from 'bun:test'
import {
    mergeAcademicCalendars,
    parseAcademicCalendar,
    parseAcademicDate
} from '../academic-calendar'

const page = (term: string, date: string, title: string) =>
    `<div class="card"><h4>${term}</h4><table><tr><td>${date}</td><td>${title}</td></tr></table></div>`
test('parses compressed ranges, German and English months, leap dates and cross-year holidays', () => {
    expect(parseAcademicDate('03.-06. April 2026')).toEqual({
        begin: '2026-04-03',
        end: '2026-04-06'
    })
    expect(parseAcademicDate('21. Dezember 2026 – 3. Januar 2027')).toEqual({
        begin: '2026-12-21',
        end: '2027-01-03'
    })
    expect(parseAcademicDate('12.–31. July 2027')).toEqual({
        begin: '2027-07-12',
        end: '2027-07-31'
    })
    expect(parseAcademicDate('05. Oktober 2026').begin).toBe('2026-10-05')
    expect(() => parseAcademicDate('29. February 2027')).toThrow()
    expect(() => parseAcademicDate('31. April 2026')).toThrow()
})
test('joins source translations by semester and actual dates and rejects mismatches', () => {
    const de = parseAcademicCalendar(
        page('Wintersemester 2026/27', '31. Oktober 2026', 'Feiertag')
    )
    const en = parseAcademicCalendar(
        page('Winter semester 2026/27', '31. October 2026', 'Public holiday')
    )
    expect(mergeAcademicCalendars(de, en)[0].events[0].name).toEqual({
        de: 'Feiertag',
        en: 'Public holiday'
    })
    expect(() =>
        mergeAcademicCalendars(
            de,
            parseAcademicCalendar(
                page(
                    'Winter semester 2026/27',
                    '30. October 2026',
                    'Public holiday'
                )
            )
        )
    ).toThrow()
    expect(() =>
        parseAcademicCalendar('<html>Service unavailable</html>')
    ).toThrow()
})

test('retains validated bilingual calendar data after refresh failure and cache restart', async () => {
    const { createAcademicCalendarService } = await import(
        '../../utils/academic-calendar'
    )
    const semesters = mergeAcademicCalendars(
        parseAcademicCalendar(
            page('Sommersemester 2027', '05. April 2027', 'Vorlesungsbeginn')
        ),
        parseAcademicCalendar(
            page('Summer semester 2027', '05. April 2027', 'Start of classes')
        )
    )
    let stored: unknown = null
    let fail = false
    const deps = {
        fetch: async () => {
            if (fail) throw Error('offline')
            return semesters
        },
        read: async () => stored,
        write: async (s: unknown) => {
            stored = s
        },
        now: () => new Date('2026-10-23T12:00:00Z')
    }
    const service = createAcademicCalendarService(deps)
    await service.refresh()
    fail = true
    await service.refresh()
    expect((await service.get()).semesters).toEqual(semesters)
    expect((await service.get()).stale).toBe(true)
    expect((await createAcademicCalendarService(deps).get()).available).toBe(
        true
    )
})

test('parses and aligns all 24 events captured from the official HAW pages', async () => {
    const de = parseAcademicCalendar(
        await Bun.file(
            new URL('../fixtures/academic-calendar-de.html', import.meta.url)
        ).text()
    )
    const en = parseAcademicCalendar(
        await Bun.file(
            new URL('../fixtures/academic-calendar-en.html', import.meta.url)
        ).text()
    )
    const semesters = mergeAcademicCalendars(de, en)
    expect(semesters.map((t) => t.events.length)).toEqual([9, 7, 8])
    const christmas = semesters
        .flatMap((t) => t.events)
        .find((e) => e.begin === '2026-12-21')
    expect(christmas?.end).toBe('2027-01-03')
    expect(christmas?.name).toEqual({
        de: 'Weihnachtsferien',
        en: 'Christmas holidays'
    })
})
