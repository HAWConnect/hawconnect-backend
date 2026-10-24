interface MigrationIdentity {
    hash: string
    folderMillis: number
}
type ReadQuery = (sql: string) => Promise<Record<string, unknown>[]>

export async function assertMigrationBaseline(
    query: ReadQuery,
    migrations: MigrationIdentity[]
): Promise<void> {
    if (!migrations.length) throw Error('MigrationFilesRequired')
    const relation = await query(
        "SELECT pg_catalog.to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists"
    )
    if (relation[0]?.exists) {
        const history = await query(
            'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id'
        )
        if (history.length) {
            if (
                history.length > migrations.length ||
                history.some(
                    (entry, index) =>
                        entry.hash !== migrations[index]?.hash ||
                        Number(entry.created_at) !==
                            migrations[index]?.folderMillis
                )
            )
                throw Error('ExistingDatabaseRequiresMigrationAdoption')
            return
        }
    }
    const existing =
        await query(`SELECT c.relname AS object_name FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
        UNION ALL SELECT t.typname AS object_name FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype IN ('e','d')`)
    if (existing.length)
        throw Error('ExistingDatabaseRequiresMigrationAdoption')
}
