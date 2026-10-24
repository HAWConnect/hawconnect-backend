import { describe, expect, test } from 'bun:test'
import { mapCampusLifeEvents } from '@/queries/campus-life'

const row = {
    id: 1,
    title_de: 'Workshop',
    title_en: 'Workshop EN',
    description_de: 'Beschreibung',
    description_en: 'Description',
    start_date_time: new Date('2030-01-01T10:00:00Z'),
    end_date_time: null,
    organizer: 'Example Club',
    location: 'BT7',
    event_url: null
}
describe('Public public campus life data', () => {
    test('publishes bilingual descriptions and events without an external URL', () => {
        const feed = mapCampusLifeEvents([row])
        expect(feed.events[0].description).toEqual({
            de: 'Beschreibung',
            en: 'Description'
        })
        expect(feed.events[0].eventUrl).toBeNull()
        expect(feed.events[0].endDateTime).toBeNull()
        expect(feed.organizers[0].name).toBe('Example Club')
    })
    test('retains organiser identity across event order and additions', () => {
        const first = mapCampusLifeEvents([row]).events[0].organizerId
        const feed = mapCampusLifeEvents([
            { ...row, id: 2, organizer: 'Another Club' },
            row
        ])
        expect(feed.events[1].organizerId).toBe(first)
        expect(feed.organizers).toHaveLength(2)
    })
    test('excludes unsafe links and unrelated row fields', () => {
        const feed = mapCampusLifeEvents([
            {
                ...row,
                event_url: 'javascript:alert(1)',
                password: 'private'
            } as typeof row
        ])
        expect(feed.events[0].eventUrl).toBeNull()
        expect('password' in feed.events[0]).toBe(false)
    })
})
