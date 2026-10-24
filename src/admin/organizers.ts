import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
export const organizerKey = (name: string) =>
    name.trim().normalize('NFKC').toLowerCase()
export const organizerId = (name: string) =>
    createHash('sha256').update(organizerKey(name)).digest().readUInt32BE(0) &
        0x7fffffff || 1
export interface OrganizerInput {
    name: string
    description: { de: string; en: string }
    location: string | null
    website: string | null
    instagram: string | null
    linkedin: string | null
    nonProfit: boolean | null
    registrationNumber: string | null
}
export function validateOrganizer(value: unknown): OrganizerInput {
    const v = value as Record<string, unknown>
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw Error('InvalidInput')
    const text = (value: unknown, max: number, required = false): string => {
        if (value == null && !required) return ''
        if (
            typeof value !== 'string' ||
            value.length > max ||
            (required && !value.trim())
        )
            throw Error('InvalidInput')
        return value.trim()
    }
    const link = (value: unknown) => {
        const raw = text(value, 2048)
        if (!raw) return null
        try {
            const url = new URL(raw)
            if (url.protocol !== 'https:' || url.username || url.password)
                throw Error()
            return url.href
        } catch {
            throw Error('InvalidInput')
        }
    }
    const description = (v.description ?? {}) as Record<string, unknown>
    if (
        typeof description !== 'object' ||
        description === null ||
        Array.isArray(description)
    )
        throw Error('InvalidInput')
    if (v.nonProfit != null && typeof v.nonProfit !== 'boolean')
        throw Error('InvalidInput')
    return {
        name: text(v.name, 250, true),
        description: {
            de: text(description.de, 20000),
            en: text(description.en, 20000)
        },
        location: text(v.location, 500) || null,
        website: link(v.website),
        instagram: link(v.instagram),
        linkedin: link(v.linkedin),
        nonProfit: (v.nonProfit as boolean | null) ?? null,
        registrationNumber: text(v.registrationNumber, 250) || null
    }
}
export function mapOrganizerProfile(row: {
    id: number
    name: string
    description_de?: string | null
    description_en?: string | null
    location?: string | null
    website_url?: string | null
    instagram_url?: string | null
    linkedin_url?: string | null
    non_profit?: boolean | null
    registration_number?: string | null
    version?: string | null
}) {
    return {
        id: row.id,
        name: row.name,
        description: {
            de: row.description_de ?? '',
            en: row.description_en ?? ''
        },
        location: row.location ?? null,
        website: row.website_url ?? null,
        instagram: row.instagram_url ?? null,
        linkedin: row.linkedin_url ?? null,
        nonProfit: row.non_profit ?? null,
        registrationNumber: row.registration_number ?? null,
        version: row.version ?? null
    }
}
export function createOrganizerRepository(pool: Pool) {
    return {
        async list() {
            const result = await pool.query(
                'SELECT *,updated_at::text AS version FROM haw_organizer_profiles ORDER BY name LIMIT 1000'
            )
            const byId = new Map(
                result.rows.map((row) => [row.id, mapOrganizerProfile(row)])
            )
            const names = await pool.query(
                'SELECT DISTINCT organizer AS name FROM manual_cl_events ORDER BY organizer LIMIT 1000'
            )
            for (const { name } of names.rows) {
                const id = organizerId(name)
                if (!byId.has(id))
                    byId.set(id, mapOrganizerProfile({ id, name }))
            }
            return [...byId.values()].sort((a, b) =>
                a.name.localeCompare(b.name)
            )
        },
        async save(
            input: OrganizerInput,
            version: string | null,
            actor: { id: string; email: string }
        ) {
            const id = organizerId(input.name)
            const key = organizerKey(input.name)
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                await client.query('SELECT pg_advisory_xact_lock($1)', [id])
                const old = await client.query(
                    'SELECT name_key,updated_at::text AS version FROM haw_organizer_profiles WHERE id=$1 FOR UPDATE',
                    [id]
                )
                if (
                    old.rows[0] &&
                    (old.rows[0].name_key !== key ||
                        old.rows[0].version !== version)
                )
                    throw Error('Conflict')
                if (!old.rows[0] && version) throw Error('Conflict')
                const values = [
                    id,
                    input.name,
                    key,
                    input.description.de,
                    input.description.en,
                    input.location,
                    input.website,
                    input.instagram,
                    input.linkedin,
                    input.nonProfit,
                    input.registrationNumber
                ]
                const result = old.rows.length
                    ? await client.query(
                          'UPDATE haw_organizer_profiles SET description_de=$4,description_en=$5,location=$6,website_url=$7,instagram_url=$8,linkedin_url=$9,non_profit=$10,registration_number=$11,updated_at=clock_timestamp() WHERE id=$1 AND name=$2 AND name_key=$3 RETURNING *,updated_at::text AS version',
                          values
                      )
                    : await client.query(
                          'INSERT INTO haw_organizer_profiles(id,name,name_key,description_de,description_en,location,website_url,instagram_url,linkedin_url,non_profit,registration_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,updated_at::text AS version',
                          values
                      )
                if (!result.rows.length) throw Error('Conflict')
                await client.query(
                    'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,$2,$3,$4,$5,now())',
                    [
                        'haw_organizer_profiles',
                        id,
                        old.rows.length ? 'update' : 'insert',
                        input.name,
                        actor.id
                    ]
                )
                await client.query('COMMIT')
                return mapOrganizerProfile(result.rows[0])
            } catch (error) {
                await client.query('ROLLBACK')
                throw error
            } finally {
                client.release()
            }
        }
    }
}
