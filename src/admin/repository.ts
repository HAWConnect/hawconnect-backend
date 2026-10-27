import type { Pool, PoolClient } from 'pg'
import { createClubsRepository } from './clubs'
import { createLegalRepository } from './legal'
import { createOrganizerRepository } from './organizers'
import { adminEmail, type Capability, capabilitiesFor } from './policy'
import { createQuickLinksRepository } from './quick-links'
import type { ContentInput, ContentKind } from './validation'

const tables = {
    announcements: 'app_announcements',
    events: 'manual_cl_events'
} as const
export function mapContent(
    kind: ContentKind,
    row: {
        id: number
        title_de: string
        title_en: string
        description_de?: string | null
        description_en?: string | null
        start_date_time: Date
        end_date_time?: Date | null
        platform?: string[]
        user_kind?: string[]
        priority?: number
        url?: string | null
        event_url?: string | null
        image_url?: string | null
        organizer?: string
        location?: string | null
        version: string
        updated_at: Date
    }
) {
    return {
        id: String(row.id),
        title: { de: row.title_de, en: row.title_en },
        description: {
            de: row.description_de ?? '',
            en: row.description_en ?? ''
        },
        startDateTime: new Date(row.start_date_time).toISOString(),
        endDateTime: row.end_date_time
            ? new Date(row.end_date_time).toISOString()
            : null,
        platform: row.platform ?? [],
        userKind: row.user_kind ?? [],
        priority: row.priority ?? 0,
        url: kind === 'events' ? row.event_url : row.url,
        imageUrl: row.image_url ?? null,
        organizer: row.organizer ?? '',
        location: row.location ?? null,
        version: row.version,
        updatedAt: new Date(row.updated_at).toISOString()
    }
}
export function createAdminRepository(pool: Pool, bootstrap: string[]) {
    const transaction = async <T>(work: (client: PoolClient) => Promise<T>) => {
        const c = await pool.connect()
        try {
            await c.query('BEGIN')
            const result = await work(c)
            await c.query('COMMIT')
            return result
        } catch (e) {
            await c.query('ROLLBACK')
            throw e
        } finally {
            c.release()
        }
    }
    const audit = async (
        c: PoolClient,
        actor: { id: string; email: string },
        entity: string,
        id: number | null,
        operation: string,
        subject?: string
    ) => {
        await c.query(
            'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,$2,$3,$4,$5,now())',
            [entity, id, operation, subject ?? actor.email, actor.id]
        )
    }
    return {
        organizers: createOrganizerRepository(pool),
        quickLinks: createQuickLinksRepository(pool),
        legal: createLegalRepository(pool),
        clubs: createClubsRepository(pool),
        async grants(email: string): Promise<Capability[]> {
            const address = adminEmail(email)
            if (bootstrap.includes(address)) return ['admin']
            const r = await pool.query(
                'SELECT capabilities FROM haw_admin_roles WHERE email=$1',
                [address]
            )
            return capabilitiesFor(
                address,
                bootstrap,
                r.rows[0]?.capabilities ?? []
            )
        },
        async permissions() {
            const r = await pool.query(
                'SELECT email,capabilities,updated_at FROM haw_admin_roles ORDER BY email LIMIT 1000'
            )
            const map = new Map(
                r.rows.map((r) => [
                    r.email,
                    {
                        email: r.email,
                        capabilities: r.capabilities,
                        bootstrap: false
                    }
                ])
            )
            for (const email of bootstrap)
                map.set(email, {
                    email,
                    capabilities: ['admin'],
                    bootstrap: true
                })
            return [...map.values()]
        },
        async setPermissions(
            email: string,
            grants: Capability[],
            actor: { id: string; email: string }
        ) {
            const address = adminEmail(email)
            if (bootstrap.includes(address)) throw Error('BootstrapProtected')
            await transaction(async (c) => {
                await c.query(
                    'LOCK TABLE haw_admin_roles IN SHARE ROW EXCLUSIVE MODE'
                )
                if (!bootstrap.length && !grants.includes('admin')) {
                    const current = await c.query(
                        "SELECT email FROM haw_admin_roles WHERE email=$1 AND 'admin'=ANY(capabilities)",
                        [address]
                    )
                    const other = await c.query(
                        "SELECT email FROM haw_admin_roles WHERE email<>$1 AND 'admin'=ANY(capabilities) LIMIT 1",
                        [address]
                    )
                    if (current.rowCount && !other.rowCount)
                        throw Error('LastAdminProtected')
                }
                await c.query(
                    'INSERT INTO haw_admin_roles(email,capabilities) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET capabilities=$2,updated_at=now()',
                    [address, grants]
                )
                await audit(
                    c,
                    actor,
                    'haw_admin_roles',
                    null,
                    'update',
                    address
                )
            })
        },
        async list(kind: ContentKind) {
            const r = await pool.query(
                `SELECT *,updated_at::text AS version FROM ${tables[kind]} ORDER BY start_date_time DESC,id DESC LIMIT 500`
            )
            return r.rows.map((r) => mapContent(kind, r))
        },
        async write(
            kind: ContentKind,
            id: number | null,
            input: ContentInput,
            version: string | undefined,
            actor: { id: string; email: string }
        ) {
            return transaction(async (c) => {
                if (id !== null) {
                    const row = await c.query(
                        `SELECT updated_at::text AS version FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`,
                        [id]
                    )
                    if (!row.rowCount) throw Error('NotFound')
                    if (!version || row.rows[0].version !== version)
                        throw Error('Conflict')
                }
                const fields =
                    kind === 'announcements'
                        ? [
                              'title_de',
                              'title_en',
                              'description_de',
                              'description_en',
                              'start_date_time',
                              'end_date_time',
                              'platform',
                              'user_kind',
                              'priority',
                              'url',
                              'image_url'
                          ]
                        : [
                              'title_de',
                              'title_en',
                              'description_de',
                              'description_en',
                              'start_date_time',
                              'end_date_time',
                              'organizer',
                              'location',
                              'event_url'
                          ]
                const values: unknown[] = [
                    input.title.de,
                    input.title.en,
                    input.description.de,
                    input.description.en,
                    input.startDateTime,
                    input.endDateTime,
                    ...(kind === 'announcements'
                        ? [
                              input.platform,
                              input.userKind,
                              input.priority,
                              input.url,
                              input.imageUrl
                          ]
                        : [input.organizer, input.location, input.url])
                ]
                let r
                if (id === null)
                    r = await c.query(
                        `INSERT INTO ${tables[kind]}(${fields.join(',')},created_at,updated_at) VALUES(${fields.map((_, i) => `$${i + 1}`).join(',')},now(),now()) RETURNING *,updated_at::text AS version`,
                        values
                    )
                else {
                    values.push(id)
                    r = await c.query(
                        `UPDATE ${tables[kind]} SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')},updated_at=clock_timestamp() WHERE id=$${values.length} RETURNING *,updated_at::text AS version`,
                        values
                    )
                }
                await audit(
                    c,
                    actor,
                    tables[kind],
                    r.rows[0].id,
                    id === null ? 'insert' : 'update'
                )
                return mapContent(kind, r.rows[0])
            })
        },
        async remove(
            kind: ContentKind,
            id: number,
            version: string | undefined,
            actor: { id: string; email: string }
        ) {
            await transaction(async (c) => {
                const r = await c.query(
                    `SELECT updated_at::text AS version FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`,
                    [id]
                )
                if (!r.rowCount) throw Error('NotFound')
                if (!version || r.rows[0].version !== version)
                    throw Error('Conflict')
                await c.query(`DELETE FROM ${tables[kind]} WHERE id=$1`, [id])
                await audit(c, actor, tables[kind], id, 'delete')
            })
        },
        async audit(limit: number, offset: number) {
            const r = await pool.query(
                'SELECT id,entity,entity_id AS "entityId",operation,name,user_id AS "userId",created_at AS "createdAt" FROM audit_log ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',
                [limit, offset]
            )
            return r.rows
        }
    }
}
export type AdminRepository = ReturnType<typeof createAdminRepository>
