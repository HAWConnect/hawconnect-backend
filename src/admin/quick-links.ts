import type { Pool } from 'pg'
export const quickLinkIcons = [
    'GraduationCap',
    'FolderOpen',
    'Library',
    'LayoutGrid',
    'FileText',
    'Mail',
    'CircleUser',
    'Globe',
    'ShoppingCart',
    'Link',
    'BookOpen',
    'Calendar',
    'MapPin',
    'Users',
    'Heart',
    'Info',
    'ExternalLink',
    'Laptop',
    'Coffee',
    'Building',
    'Bell',
    'Briefcase',
    'Code',
    'MessageCircle'
] as const
export interface QuickLink {
    key: string
    title: { de: string; en: string }
    url: { de: string; en: string }
    icon: (typeof quickLinkIcons)[number]
    visible: boolean
}
export function validateQuickLinks(value: unknown): QuickLink[] {
    if (!Array.isArray(value) || value.length > 100) throw Error('InvalidInput')
    const seen = new Set<string>()
    return value.map((item) => {
        if (
            !item ||
            typeof item !== 'object' ||
            typeof item.key !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(item.key) ||
            seen.has(item.key) ||
            !quickLinkIcons.includes(item.icon) ||
            typeof item.visible !== 'boolean'
        )
            throw Error('InvalidInput')
        seen.add(item.key)
        const pair = (value: unknown, max: number) => {
            if (!value || typeof value !== 'object') throw Error('InvalidInput')
            const v = value as Record<string, unknown>
            for (const language of ['de', 'en'])
                if (
                    typeof v[language] !== 'string' ||
                    !v[language].trim() ||
                    v[language].length > max
                )
                    throw Error('InvalidInput')
            return { de: String(v.de).trim(), en: String(v.en).trim() }
        }
        const title = pair(item.title, 120)
        const url = pair(item.url, 2048)
        for (const raw of Object.values(url)) {
            try {
                const u = new URL(raw)
                if (
                    u.protocol !== 'https:' ||
                    !u.hostname ||
                    u.username ||
                    u.password
                )
                    throw Error()
            } catch {
                throw Error('InvalidInput')
            }
        }
        return {
            key: item.key,
            title,
            url,
            icon: item.icon,
            visible: item.visible
        }
    })
}
export function createQuickLinksRepository(pool: Pool) {
    return {
        async read(publicOnly = false) {
            const result = await pool.query(
                'SELECT links,version FROM haw_quick_links WHERE id=1'
            )
            const row = result.rows[0]
            const links = row ? validateQuickLinks(row.links) : []
            return {
                managed: !!row,
                version: row?.version ?? null,
                links: publicOnly ? links.filter((link) => link.visible) : links
            }
        },
        async write(
            value: unknown,
            version: unknown,
            actor: { id: string; email: string }
        ) {
            if (version !== null && typeof version !== 'string')
                throw Error('InvalidInput')
            const links = validateQuickLinks(value)
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                await client.query('SELECT pg_advisory_xact_lock(17402603)')
                const previous = await client.query(
                    'SELECT version FROM haw_quick_links WHERE id=1 FOR UPDATE'
                )
                if ((previous.rows[0]?.version ?? null) !== version)
                    throw Error('Conflict')
                const next = crypto.randomUUID()
                await client.query(
                    'INSERT INTO haw_quick_links(id,links,version) VALUES(1,$1::jsonb,$2) ON CONFLICT(id) DO UPDATE SET links=EXCLUDED.links,version=EXCLUDED.version,updated_at=now()',
                    [JSON.stringify(links), next]
                )
                await client.query(
                    'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,1,$2,$3,$4,now())',
                    ['haw_quick_links', 'save', 'Quick Links', actor.id]
                )
                await client.query('COMMIT')
                return { managed: true, version: next, links }
            } catch (error) {
                await client.query('ROLLBACK')
                throw error
            } finally {
                client.release()
            }
        }
    }
}
