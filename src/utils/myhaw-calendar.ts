const MAX_BYTES = 2_000_000
const EXPORT_PATH =
    '/qisserver/pages/cm/exa/timetable/individualTimetableCalendarExport.faces'
export function validateMyHawUrl(input: string): URL {
    const url = new URL(input)
    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'myhaw.haw-hamburg.de' ||
        url.port ||
        url.username ||
        url.password ||
        url.pathname !== EXPORT_PATH ||
        url.hash ||
        !url.searchParams.get('user') ||
        !url.searchParams.get('hash') ||
        [...url.searchParams.keys()].some(
            (k) => !['user', 'hash', 'termgroup'].includes(k)
        )
    )
        throw Error('InvalidCalendarLink')
    return url
}
export async function fetchMyHawCalendar(
    input: string,
    transport: typeof fetch = fetch
): Promise<string> {
    try {
        const url = validateMyHawUrl(input)
        const response = await transport(url.toString(), {
            redirect: 'error',
            credentials: 'omit',
            signal: AbortSignal.timeout(15000),
            headers: {
                Accept: '*/*',
                'User-Agent': 'HAWConnect/0.1 calendar importer'
            }
        })
        if (
            !response.ok ||
            Number(response.headers.get('content-length')) > MAX_BYTES
        )
            throw Error()
        let text = ''
        if (response.body) {
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let bytes = 0
            while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                bytes += chunk.value.byteLength
                if (bytes > MAX_BYTES) {
                    await reader.cancel()
                    throw Error()
                }
                text += decoder.decode(chunk.value, { stream: true })
            }
            text += decoder.decode()
        } else text = await response.text()
        if (
            new TextEncoder().encode(text).length > MAX_BYTES ||
            !/^\uFEFF?\s*BEGIN:VCALENDAR\s*$/m.test(text) ||
            !/^END:VCALENDAR\s*$/m.test(text)
        )
            throw Error()
        return text
    } catch {
        throw Error('CalendarDownloadFailed')
    }
}
