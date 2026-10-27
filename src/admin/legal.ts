import { load } from 'cheerio'
import type { Pool } from 'pg'
import sanitizeHtml from 'sanitize-html'

export const legalKeys = ['privacy', 'imprint'] as const
export type LegalKey = (typeof legalKeys)[number]
export interface LegalDraft {
    mode: 'internal' | 'external'
    body: { de: string; en: string }
    bodyHtml?: { de: string; en: string } | null
    url: { de: string; en: string }
}
export function legalKey(value: string): LegalKey {
    if (!legalKeys.includes(value as LegalKey)) throw Error('NotFound')
    return value as LegalKey
}
export const emptyLegalDraft = (): LegalDraft => ({
    mode: 'internal',
    body: { de: '', en: '' },
    url: { de: '', en: '' }
})
export function validateLegalDraft(value: unknown): LegalDraft {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('InvalidInput')
    const input = value as Record<string, unknown>
    if (input.mode !== 'internal' && input.mode !== 'external')
        throw Error('InvalidInput')
    const pair = (value: unknown, max: number, trim = true) => {
        if (
            value != null &&
            (typeof value !== 'object' || Array.isArray(value))
        )
            throw Error('InvalidInput')
        const v = (value ?? {}) as Record<string, unknown>
        const text = (v: unknown) => {
            if (v == null) return ''
            if (typeof v !== 'string' || v.length > max)
                throw Error('InvalidInput')
            return trim ? v.trim() : v
        }
        return { de: text(v.de), en: text(v.en) }
    }
    const url = pair(input.url, 2048)
    for (const raw of Object.values(url))
        if (raw) {
            try {
                const u = new URL(raw)
                if (u.protocol !== 'https:' || u.username || u.password)
                    throw Error()
            } catch {
                throw Error('InvalidInput')
            }
        }
    if (input.bodyHtml != null) {
        const raw = pair(input.bodyHtml, 20000)
        const sanitize = (html: string) =>
            sanitizeHtml(html, {
                allowedTags: [
                    'p',
                    'br',
                    'strong',
                    'b',
                    'em',
                    'i',
                    'h2',
                    'h3',
                    'ul',
                    'ol',
                    'li',
                    'blockquote',
                    'a'
                ],
                allowedAttributes: { a: ['href'] },
                allowedSchemes: ['https', 'mailto'],
                allowProtocolRelative: false,
                transformTags: {
                    a: (tagName, attribs) => {
                        if (attribs.href) {
                            try {
                                const u = new URL(attribs.href)
                                if (
                                    !['https:', 'mailto:'].includes(
                                        u.protocol
                                    ) ||
                                    u.username ||
                                    u.password
                                )
                                    throw Error()
                                attribs.href = u.href
                            } catch {
                                delete attribs.href
                            }
                        }
                        return { tagName, attribs }
                    }
                }
            })
        const bodyHtml = { de: sanitize(raw.de), en: sanitize(raw.en) }
        const plain = (html: string) => {
            const $ = load(html)
            $('br').replaceWith('\n')
            $('p,h2,h3,li,blockquote').append('\n')
            return $.text().trim()
        }
        const body = { de: plain(bodyHtml.de), en: plain(bodyHtml.en) }
        if (
            [...Object.values(bodyHtml), ...Object.values(body)].some(
                (text) => text.length > 20000
            )
        )
            throw Error('InvalidInput')
        return {
            mode: input.mode,
            body,
            bodyHtml,
            url
        }
    }
    return {
        mode: input.mode,
        body: pair(input.body, 20000, false),
        ...(input.bodyHtml === null ? { bodyHtml: null } : {}),
        url
    }
}
export function validateLegalPublication(value: unknown): LegalDraft {
    const draft = validateLegalDraft(value)
    const fields = draft.mode === 'internal' ? draft.body : draft.url
    if (
        !fields.de.replace(
            /[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
            ''
        ) ||
        !fields.en.replace(
            /[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
            ''
        )
    )
        throw Error('InvalidInput')
    return draft.mode === 'internal'
        ? { ...draft, url: { de: '', en: '' } }
        : { mode: draft.mode, body: { de: '', en: '' }, url: draft.url }
}
function mapRow(key: LegalKey, row?: Record<string, unknown>) {
    return {
        key,
        draft: validateLegalDraft(row?.draft ?? emptyLegalDraft()),
        published: row?.published
            ? validateLegalPublication(row.published)
            : null,
        version: (row?.version ?? null) as string | null,
        publishedAt: row?.published_at
            ? new Date(String(row.published_at)).toISOString()
            : null
    }
}
export function createLegalRepository(pool: Pool) {
    return {
        async list() {
            const rows = await pool.query(
                'SELECT document_key,draft,published,version,published_at FROM haw_legal_documents'
            )
            return legalKeys.map((key) =>
                mapRow(
                    key,
                    rows.rows.find((r) => r.document_key === key)
                )
            )
        },
        async publicList() {
            const rows = await pool.query(
                'SELECT document_key,published,published_at FROM haw_legal_documents'
            )
            return legalKeys.map((key) => {
                const row = rows.rows.find((r) => r.document_key === key)
                return {
                    key,
                    managed: !!row,
                    published: row?.published
                        ? validateLegalPublication(row.published)
                        : null,
                    publishedAt: row?.published_at
                        ? new Date(row.published_at).toISOString()
                        : null
                }
            })
        },
        async write(
            key: LegalKey,
            action: 'save' | 'publish' | 'withdraw',
            value: unknown,
            version: string | null,
            actor: { id: string; email: string }
        ) {
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                await client.query('SELECT pg_advisory_xact_lock($1)', [
                    key === 'privacy' ? 17402601 : 17402602
                ])
                const previous = await client.query(
                    'SELECT *,published_at::text FROM haw_legal_documents WHERE document_key=$1 FOR UPDATE',
                    [key]
                )
                const row = previous.rows[0]
                if ((row?.version ?? null) !== version) throw Error('Conflict')
                const draft =
                    action === 'save'
                        ? validateLegalDraft(value)
                        : validateLegalDraft(row?.draft ?? emptyLegalDraft())
                const published =
                    action === 'publish'
                        ? validateLegalPublication(draft)
                        : action === 'withdraw'
                          ? null
                          : (row?.published ?? null)
                const publishedAt =
                    action === 'publish'
                        ? new Date().toISOString()
                        : action === 'withdraw'
                          ? null
                          : (row?.published_at ?? null)
                const result = await client.query(
                    'INSERT INTO haw_legal_documents(document_key,draft,published,version,published_at) VALUES($1,$2::jsonb,$3::jsonb,$4,$5) ON CONFLICT(document_key) DO UPDATE SET draft=EXCLUDED.draft,published=EXCLUDED.published,version=EXCLUDED.version,published_at=EXCLUDED.published_at,updated_at=now() RETURNING *',
                    [
                        key,
                        JSON.stringify(draft),
                        published ? JSON.stringify(published) : null,
                        crypto.randomUUID(),
                        publishedAt
                    ]
                )
                await client.query(
                    'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,$2,$3,$4,$5,now())',
                    [
                        'haw_legal_documents',
                        key === 'privacy' ? 1 : 2,
                        action,
                        key,
                        actor.id
                    ]
                )
                await client.query('COMMIT')
                return mapRow(key, result.rows[0])
            } catch (error) {
                await client.query('ROLLBACK')
                throw error
            } finally {
                client.release()
            }
        }
    }
}
