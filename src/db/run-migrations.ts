import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { assertMigrationBaseline } from './migration-baseline'

export async function runProjectMigrations(
    connectionString: string,
    migrationsFolder = './src/db/migrations'
): Promise<void> {
    const migrations = readMigrationFiles({ migrationsFolder })
    const pool = new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 10000
    })
    const connection = await pool.connect().catch(async (error) => {
        await pool.end()
        throw error
    })
    let locked = false
    try {
        await connection.query(
            "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtext('hawconnect-schema-migrations'))"
        )
        locked = true
        await connection.query('SET search_path TO public')
        await assertMigrationBaseline(
            async (sql) => (await connection.query(sql)).rows,
            migrations
        )
        await migrate(drizzle(connection), { migrationsFolder })
    } finally {
        try {
            if (locked)
                await connection.query(
                    "SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('hawconnect-schema-migrations'))"
                )
        } finally {
            connection.release()
            await pool.end()
        }
    }
}
