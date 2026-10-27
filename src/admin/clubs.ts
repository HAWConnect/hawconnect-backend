import { load } from 'cheerio'
import type { Pool } from 'pg'
import sanitizeHtml from 'sanitize-html'
import type { HawClub } from '@/types/haw-club'

type Language = 'de' | 'en'
interface Content extends HawClub {
    descriptionHtml: string
}
export interface ClubRow {
    editor_id: string
    source_id: string | null
    source_title?: string | null
    language: Language
    content: Content
    version: string
    updated_at?: string | Date
}
function safeUrl(value: unknown, mail = false): string {
    if (typeof value !== 'string' || value.length > 2048)
        throw Error('InvalidInput')
    try {
        const url = new URL(value)
        if (
            !(mail ? ['https:', 'mailto:'] : ['https:']).includes(
                url.protocol
            ) ||
            url.username ||
            url.password
        )
            throw Error()
        return url.href
    } catch {
        throw Error('InvalidInput')
    }
}
export function validateClub(value: unknown): Content {
    if (!value || typeof value !== 'object') throw Error('InvalidInput')
    const v = value as Record<string, unknown>
    if (
        !['de', 'en'].includes(String(v.language)) ||
        typeof v.title !== 'string' ||
        !v.title.trim() ||
        v.title.length > 300 ||
        typeof v.descriptionHtml !== 'string' ||
        v.descriptionHtml.length > 50000 ||
        !Array.isArray(v.links) ||
        v.links.length > 30
    )
        throw Error('InvalidInput')
    const html = sanitizeHtml(v.descriptionHtml, {
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
            'a',
            'img'
        ],
        allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
        allowedSchemes: ['https', 'mailto'],
        allowedSchemesByTag: { img: ['https'] },
        allowProtocolRelative: false,
        transformTags: {
            '*': (tagName, attribs) => {
                const name =
                    tagName === 'img' ? 'src' : tagName === 'a' ? 'href' : null
                if (name && attribs[name]) {
                    try {
                        attribs[name] = safeUrl(attribs[name], tagName === 'a')
                    } catch {
                        delete attribs[name]
                    }
                }
                return { tagName, attribs }
            }
        }
    })
    const $ = load(html)
    $('br').replaceWith('\n')
    $('p,h2,h3,li,blockquote').append('\n')
    return {
        id: '',
        title: v.title.trim(),
        descriptionHtml: html,
        description: $.text().trim(),
        sourceUrl: safeUrl(v.sourceUrl),
        links: v.links.map((link) => {
            if (
                !link ||
                typeof link.title !== 'string' ||
                !link.title.trim() ||
                link.title.length > 300
            )
                throw Error('InvalidInput')
            return { title: link.title.trim(), url: safeUrl(link.url, true) }
        })
    }
}
export function managedClubs(rows: ClubRow[], language: Language) {
    const groups = new Map<string, ClubRow[]>()
    for (const row of rows)
        groups.set(row.editor_id, [...(groups.get(row.editor_id) ?? []), row])
    return [...groups.values()].map((translations) => {
        const row =
            translations.find((r) => r.language === language) ?? translations[0]
        return {
            ...row.content,
            id: row.editor_id,
            editorId: row.editor_id,
            origin: 'manual',
            version: row.version,
            contentLanguage: row.language
        }
    })
}
export function createClubsRepository(pool: Pool) {
    const list = async (): Promise<ClubRow[]> => {
        try {
            return (
                await pool.query(
                    'SELECT editor_id,source_id,source_title,language,content,version,updated_at FROM haw_club_content ORDER BY created_at,editor_id,language'
                )
            ).rows
        } catch (error) {
            if ((error as { code?: string }).code === '42P01')
                throw Error('ClubsSetupRequired')
            throw error
        }
    }
    return {
        list,
        async write(value: unknown, actor: { id: string }, remove = false) {
            const v = value as Record<string, unknown>
            if (!v || (v.version !== null && typeof v.version !== 'string'))
                throw Error('InvalidInput')
            const content = remove ? null : validateClub(value)
            const language = v.language as Language
            if (v.sourceId != null || v.sourceTitle != null)
                throw Error('InvalidInput')
            const key =
                typeof v.editorId === 'string'
                    ? v.editorId
                    : `manual:${crypto.randomUUID()}`
            if (
                key.length > 700 ||
                (!key.startsWith('manual:') && !key.startsWith('scraped:'))
            )
                throw Error('InvalidInput')
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                await client.query(
                    'SELECT pg_advisory_xact_lock(hashtext($1))',
                    [key]
                )
                const old = (
                    await client.query(
                        'SELECT * FROM haw_club_content WHERE editor_id=$1 FOR UPDATE',
                        [key]
                    )
                ).rows as ClubRow[]
                const previous =
                    old.find((r) => r.language === language) ?? old[0]
                if ((previous?.version ?? null) !== v.version)
                    throw Error('Conflict')
                if (!remove && v.editorId && !old.length)
                    throw Error('InvalidInput')
                if (remove) {
                    if (!old.length) throw Error('NotFound')
                    await client.query(
                        'DELETE FROM haw_club_content WHERE editor_id=$1',
                        [key]
                    )
                } else {
                    const version = crypto.randomUUID()
                    await client.query(
                        'INSERT INTO haw_club_content(editor_id,source_id,language,content,version,source_title) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(editor_id,language) DO UPDATE SET content=EXCLUDED.content,version=EXCLUDED.version,updated_at=now()',
                        [
                            key,
                            previous?.language === language
                                ? previous.source_id
                                : null,
                            language,
                            JSON.stringify(content),
                            version,
                            previous?.language === language
                                ? previous.source_title
                                : null
                        ]
                    )
                    await client.query(
                        'UPDATE haw_club_content SET version=$2,updated_at=now() WHERE editor_id=$1',
                        [key, version]
                    )
                }
                await client.query(
                    'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,NULL,$2,$3,$4,now())',
                    [
                        'haw_club_content',
                        remove ? 'delete' : 'save',
                        key,
                        actor.id
                    ]
                )
                const rows = remove
                    ? []
                    : (
                          await client.query(
                              'SELECT * FROM haw_club_content WHERE editor_id=$1',
                              [key]
                          )
                      ).rows
                await client.query('COMMIT')
                return remove ? { ok: true } : managedClubs(rows, language)[0]
            } catch (error) {
                await client.query('ROLLBACK')
                if ((error as { code?: string }).code === '42P01')
                    throw Error('ClubsSetupRequired')
                throw error
            } finally {
                client.release()
            }
        }
    }
}
