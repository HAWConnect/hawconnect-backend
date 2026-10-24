import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// Retained data only; no public query or university service is enabled by this table.
// Keep this in the schema so future generation does not propose dropping the data.
export const legacyEvents = pgTable(
    'haw_legacy_events',
    {
        id: serial('id').primaryKey(),
        title_de: text('title_de').notNull(),
        title_en: text('title_en').notNull(),
        description_de: text('description_de'),
        description_en: text('description_en'),
        location: text('location'),
        created_at: timestamp('created_at', { withTimezone: true })
            .defaultNow()
            .notNull(),
        updated_at: timestamp('updated_at', { withTimezone: true }),
        start_time: timestamp('start_time', { withTimezone: true }),
        end_time: timestamp('end_time', { withTimezone: true }),
        rrule: text('rrule')
    },
    (table) => ({
        startTime: index('haw_legacy_events_start_time_idx').on(
            table.start_time
        )
    })
)
