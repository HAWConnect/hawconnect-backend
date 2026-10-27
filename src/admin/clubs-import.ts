import type { Pool } from 'pg'
import { validateClub } from './clubs'

type Content = ReturnType<typeof validateClub>
interface SeedClub {
    editorId: string
    legacyIds: { de: string; en: string }
    content: { de: Content; en: Content }
}
export function validateClubImport(value: unknown) {
    try {
        if (!value || typeof value !== 'object') throw Error()
        const v = value as Record<string, unknown>
        if (
            typeof v.importKey !== 'string' ||
            !/^[a-z0-9-]{1,100}$/.test(v.importKey) ||
            typeof v.capturedAt !== 'string' ||
            !Number.isFinite(Date.parse(v.capturedAt)) ||
            !Array.isArray(v.clubs) ||
            !v.clubs.length ||
            v.clubs.length > 100
        )
            throw Error()
        const ids = new Set<string>()
        const legacy = new Set<string>()
        const clubs: SeedClub[] = v.clubs.map((raw) => {
            if (
                !raw ||
                typeof raw.editorId !== 'string' ||
                !/^manual:initial:[a-z0-9-]{1,100}$/.test(raw.editorId) ||
                ids.has(raw.editorId)
            )
                throw Error()
            ids.add(raw.editorId)
            for (const language of ['de', 'en'] as const) {
                const id = raw.legacyIds?.[language]
                if (
                    typeof id !== 'string' ||
                    !id ||
                    id.length > 300 ||
                    legacy.has(`${language}:${id}`)
                )
                    throw Error()
                legacy.add(`${language}:${id}`)
            }
            return {
                editorId: raw.editorId,
                legacyIds: { de: raw.legacyIds.de, en: raw.legacyIds.en },
                content: {
                    de: validateClub({ ...raw.content?.de, language: 'de' }),
                    en: validateClub({ ...raw.content?.en, language: 'en' })
                }
            }
        })
        return {
            importKey: v.importKey,
            capturedAt: new Date(v.capturedAt).toISOString(),
            clubs
        }
    } catch {
        throw Error('InvalidClubImport')
    }
}
export async function importExistingClubs(pool: Pool, value: unknown) {
    const seed = validateClubImport(value)
    const client = await pool.connect().catch(() => {
        throw Error('ClubImportFailed')
    })
    try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            'haw-clubs-offline-import'
        ])
        const done = await client.query(
            'SELECT import_key FROM haw_club_imports WHERE import_key=$1',
            [seed.importKey]
        )
        if (done.rowCount) {
            await client.query('COMMIT')
            return {
                alreadyImported: true,
                importedClubs: 0,
                importedTranslations: 0,
                keptClubs: seed.clubs.length
            }
        }
        let importedClubs = 0
        let keptClubs = 0
        for (const club of seed.clubs) {
            // Same per-club lock as ordinary CRUD; the global lock serializes imports.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
                club.editorId
            ])
            const existing = await client.query(
                'SELECT editor_id FROM haw_club_content WHERE editor_id=$1 OR (language=$2 AND source_id=$3) OR (language=$4 AND source_id=$5)',
                [
                    club.editorId,
                    'de',
                    club.legacyIds.de,
                    'en',
                    club.legacyIds.en
                ]
            )
            if (existing.rowCount) {
                keptClubs++
                continue
            }
            const version = crypto.randomUUID()
            for (const language of ['de', 'en'] as const)
                await client.query(
                    'INSERT INTO haw_club_content(editor_id,language,source_id,source_title,content,version) VALUES($1,$2,NULL,NULL,$3::jsonb,$4)',
                    [
                        club.editorId,
                        language,
                        JSON.stringify(club.content[language]),
                        version
                    ]
                )
            await client.query(
                'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,NULL,$2,$3,$4,now())',
                [
                    'haw_club_content',
                    'import',
                    club.editorId,
                    'local-cli:clubs-import-existing'
                ]
            )
            importedClubs++
        }
        await client.query(
            'INSERT INTO haw_club_imports(import_key,captured_at,imported_clubs,kept_clubs) VALUES($1,$2,$3,$4)',
            [seed.importKey, seed.capturedAt, importedClubs, keptClubs]
        )
        await client.query('COMMIT')
        return {
            alreadyImported: false,
            importedClubs,
            importedTranslations: importedClubs * 2,
            keptClubs
        }
    } catch {
        try {
            await client.query('ROLLBACK')
        } catch {
            /* Preserve the safe import error even after connection loss. */
        }
        throw Error('ClubImportFailed')
    } finally {
        client.release()
    }
}
