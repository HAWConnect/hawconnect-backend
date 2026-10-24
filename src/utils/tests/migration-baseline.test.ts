import { describe, expect, it } from 'bun:test'
import { assertMigrationBaseline } from '../../db/migration-baseline'

describe('fresh migration baseline safety', () => {
    const migrations = [{ hash: 'baseline-hash', folderMillis: 1000 }]
    function query(
        history: Record<string, unknown>[] | null,
        tables: Record<string, unknown>[] = []
    ) {
        return async (sql: string) => {
            if (!sql.startsWith('SELECT')) throw Error('GuardMustBeReadOnly')
            if (sql.includes('to_regclass'))
                return [{ exists: history !== null }]
            if (sql.includes('SELECT hash')) return history ?? []
            return tables
        }
    }
    it('accepts an empty schema', async () => {
        await expect(
            assertMigrationBaseline(query(null), migrations)
        ).resolves.toBeUndefined()
    })
    it('accepts a recognised applied baseline without touching existing data', async () => {
        await expect(
            assertMigrationBaseline(
                query(
                    [{ hash: 'baseline-hash', created_at: '1000' }],
                    [{ tablename: 'haw_user' }]
                ),
                migrations
            )
        ).resolves.toBeUndefined()
    })
    it('rejects historical or modified migration journals', async () => {
        for (const history of [
            [{ hash: 'old-history', created_at: '500' }],
            [{ hash: 'baseline-hash', created_at: '500' }]
        ])
            await expect(
                assertMigrationBaseline(query(history), migrations)
            ).rejects.toThrow('ExistingDatabaseRequiresMigrationAdoption')
    })
    it('rejects existing application or account tables without a matching journal', async () => {
        for (const history of [null, []])
            await expect(
                assertMigrationBaseline(
                    query(history, [{ tablename: 'haw_user' }]),
                    migrations
                )
            ).rejects.toThrow('ExistingDatabaseRequiresMigrationAdoption')
    })
})
