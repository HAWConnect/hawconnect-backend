import type { Pool } from 'pg'
export async function publicClubEvents(
    pool: Pool,
    language: string,
    now = new Date()
) {
    const result = await pool.query(
        'SELECT id,title_de,title_en,start_date_time,end_date_time,location,event_url FROM manual_cl_events WHERE COALESCE(end_date_time,start_date_time) >= $1 AND event_url IS NOT NULL ORDER BY start_date_time,id LIMIT 500',
        [now]
    )
    const locale = language.startsWith('de') ? 'de-DE' : 'en-GB'
    const date = (time: Date) =>
        new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Europe/Berlin',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(time)
    return result.rows.flatMap((row) => {
        try {
            const url = new URL(row.event_url)
            if (url.protocol !== 'https:' || url.username || url.password)
                return []
            const start = new Date(row.start_date_time)
            const end = row.end_date_time ? new Date(row.end_date_time) : null
            const time = (value: Date) =>
                new Intl.DateTimeFormat(locale, {
                    timeZone: 'Europe/Berlin',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(value)
            return [
                {
                    id: `club:${row.id}`,
                    title: language.startsWith('de')
                        ? row.title_de
                        : row.title_en,
                    sourceUrl: url.toString(),
                    date: date(start),
                    endDate:
                        end && date(end) !== date(start) ? date(end) : null,
                    dateLabel: new Intl.DateTimeFormat(locale, {
                        timeZone: 'Europe/Berlin',
                        dateStyle: 'medium'
                    }).format(start),
                    timeLabel: time(start) + (end ? ` – ${time(end)}` : ''),
                    startTime: start.toISOString(),
                    endTime: end?.toISOString() ?? null,
                    location: row.location,
                    origin: 'CLUB'
                }
            ]
        } catch {
            return []
        }
    })
}
