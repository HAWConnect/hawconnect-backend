import { expect, test } from 'bun:test'
import { fetchMyHawCalendar, validateMyHawUrl } from '../myhaw-calendar'

const link =
    'https://myhaw.haw-hamburg.de:443/qisserver/pages/cm/exa/timetable/individualTimetableCalendarExport.faces?user=test&hash=test&termgroup='
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
test('permits only the exact HTTPS myHAW export endpoint', () => {
    expect(validateMyHawUrl(link).hostname).toBe('myhaw.haw-hamburg.de')
    for (const url of [
        link.replace('https:', 'http:'),
        link.replace(':443', ':8080'),
        link.replace('myhaw.haw-hamburg.de', 'localhost'),
        link.replace('/individualTimetableCalendarExport.faces', '/other'),
        link.replace('https://', 'https://user:pass@')
    ])
        expect(() => validateMyHawUrl(url)).toThrow()
})
test('downloads calendar data without cookies, follows no redirects and bounds response size', async () => {
    expect(
        await fetchMyHawCalendar(link, async (_url, init) => {
            expect(init?.redirect).toBe('error')
            expect(init?.credentials).toBe('omit')
            expect(new Headers(init?.headers).get('Accept')).toBe('*/*')
            return new Response(ics)
        })
    ).toBe(ics)
    for (const response of [
        new Response('<html>login</html>'),
        new Response(null, {
            status: 303,
            headers: { Location: 'https://example.com' }
        }),
        new Response('x'.repeat(2_000_001))
    ]) {
        await expect(
            fetchMyHawCalendar(link, async () => response)
        ).rejects.toThrow()
    }
})
test('redacts errors containing private links', async () => {
    await expect(
        fetchMyHawCalendar(link, async () => {
            throw Error(link)
        })
    ).rejects.toThrow('CalendarDownloadFailed')
})
