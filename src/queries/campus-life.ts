import type { Pool } from 'pg'
import { mapOrganizerProfile, organizerId } from '@/admin/organizers'
import { accountRuntime } from '@/lib/account-runtime'

interface PublicRow {
    id: number
    title_de: string
    title_en: string
    description_de: string | null
    description_en: string | null
    start_date_time: Date
    end_date_time: Date | null
    organizer: string
    location: string | null
    event_url: string | null
}
export function mapCampusLifeEvents(rows: PublicRow[]) {
    const organizers = new Map<number, ReturnType<typeof mapOrganizerProfile>>()
    const events = rows.map((row) => {
        const name = row.organizer.trim()
        const id = organizerId(name)
        const existing = organizers.get(id)
        if (
            existing &&
            existing.name.normalize('NFKC').toLowerCase() !==
                name.normalize('NFKC').toLowerCase()
        )
            throw Error('OrganizerIdentityConflict')
        organizers.set(id, mapOrganizerProfile({ id, name }))
        let eventUrl: string | null = null
        try {
            const u = new URL(row.event_url ?? '')
            if (u.protocol === 'https:' && !u.username && !u.password)
                eventUrl = u.href
        } catch {
            /* An external link is optional. */
        }
        return {
            id: row.id,
            organizerId: id,
            organizerName: name,
            title: { de: row.title_de, en: row.title_en },
            description: { de: row.description_de, en: row.description_en },
            startDateTime: new Date(row.start_date_time).toISOString(),
            endDateTime: row.end_date_time
                ? new Date(row.end_date_time).toISOString()
                : null,
            location: row.location,
            eventUrl
        }
    })
    return {
        available: true,
        events,
        organizers: [...organizers.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
        )
    }
}
export async function publicCampusLifeEvents(pool: Pool) {
    // Public content fields only; account records, audit data and credentials are never selected.
    const result = await pool.query(
        'SELECT id,title_de,title_en,description_de,description_en,start_date_time,end_date_time,organizer,location,event_url FROM manual_cl_events ORDER BY start_date_time DESC,id DESC LIMIT 500'
    )
    const feed = mapCampusLifeEvents(result.rows)
    try {
        const profiles = await pool.query(
            'SELECT id,name,description_de,description_en,location,website_url,instagram_url,linkedin_url,non_profit,registration_number FROM haw_organizer_profiles ORDER BY name LIMIT 1000'
        )
        const organizers = new Map(
            feed.organizers.map((profile) => [profile.id, profile])
        )
        for (const row of profiles.rows)
            organizers.set(row.id, mapOrganizerProfile(row))
        feed.organizers = [...organizers.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
        )
    } catch (error) {
        if ((error as { code?: string }).code !== '42P01') throw error
        // Profiles are additive: an unapplied profile migration must not hide existing events.
    }
    return feed
}
export async function campusLifeEvents() {
    if (accountRuntime)
        try {
            return await publicCampusLifeEvents(accountRuntime.pool)
        } catch {
            /* Preserve an honest unavailable state without database diagnostics. */
        }
    return { available: false, events: [], organizers: [] }
}
