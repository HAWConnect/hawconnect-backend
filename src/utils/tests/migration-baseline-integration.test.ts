import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Pool } from 'pg'
import { runProjectMigrations } from '../../db/run-migrations'

const databaseURL = process.env.HAWCONNECT_MIGRATION_TEST_URL
const suite = databaseURL ? describe : describe.skip
suite('fresh baseline runner (disposable local PostgreSQL only)', () => {
    const url = databaseURL ? new URL(databaseURL) : null
    if (
        url &&
        (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
            url.pathname !== '/hawconnect_migration_test')
    )
        throw Error('DisposableMigrationDatabaseRequired')
    const pool = new Pool({ connectionString: databaseURL })
    const run = () => runProjectMigrations(databaseURL ?? '')
    beforeEach(async () => {
        await pool.query(
            'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE'
        )
    })
    afterAll(() => pool.end())
    it('creates a complete project-named baseline with working sequence and index', async () => {
        await run()
        const tables = await pool.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
        )
        expect(tables.rows.map((r) => r.tablename)).toEqual([
            'app_announcements',
            'audit_log',
            'haw_legacy_events',
            'manual_cl_events',
            'room_reports'
        ])
        const row = await pool.query(
            `INSERT INTO haw_legacy_events (title_de,title_en) VALUES ('Beispiel','Example') RETURNING id,start_time`
        )
        expect(row.rows).toEqual([{ id: 1, start_time: null }])
        expect(
            (
                await pool.query(
                    `SELECT pg_get_serial_sequence('haw_legacy_events','id') AS sequence`
                )
            ).rows[0].sequence
        ).toBe('public.haw_legacy_events_id_seq')
        expect(
            (
                await pool.query(
                    `SELECT to_regclass('public.haw_legacy_events_pkey') IS NOT NULL AS pk, to_regclass('public.haw_legacy_events_start_time_idx') IS NOT NULL AS idx`
                )
            ).rows[0]
        ).toEqual({ pk: true, idx: true })
    })
    it('replays a recognised baseline without changing existing rows', async () => {
        await run()
        await pool.query(
            `INSERT INTO haw_legacy_events (title_de,title_en) VALUES ('Behalten','Keep')`
        )
        await run()
        expect(
            (await pool.query('SELECT title_en FROM haw_legacy_events')).rows
        ).toEqual([{ title_en: 'Keep' }])
        expect(
            (
                await pool.query(
                    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'
                )
            ).rows[0].count
        ).toBe(1)
    })
    it('rejects nonempty databases before creating baseline objects or tracking tables', async () => {
        await pool.query(
            `CREATE TABLE existing_records (value text); INSERT INTO existing_records VALUES ('keep')`
        )
        await expect(run()).rejects.toThrow(
            'ExistingDatabaseRequiresMigrationAdoption'
        )
        expect(
            (await pool.query('SELECT value FROM existing_records')).rows
        ).toEqual([{ value: 'keep' }])
        expect(
            (
                await pool.query(
                    `SELECT to_regclass('public.haw_legacy_events') AS events, to_regclass('drizzle.__drizzle_migrations') AS journal`
                )
            ).rows[0]
        ).toEqual({ events: null, journal: null })
    })
    it('rejects old migration history without changing that history', async () => {
        await pool.query(
            `CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint); INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('previous-chain',500)`
        )
        await expect(run()).rejects.toThrow(
            'ExistingDatabaseRequiresMigrationAdoption'
        )
        expect(
            (await pool.query('SELECT hash FROM drizzle.__drizzle_migrations'))
                .rows
        ).toEqual([{ hash: 'previous-chain' }])
        expect(
            (
                await pool.query(
                    `SELECT to_regclass('public.haw_legacy_events') AS events`
                )
            ).rows[0].events
        ).toBeNull()
    })
    it('serialises concurrent runners on the same database', async () => {
        await Promise.all([run(), run()])
        expect(
            (
                await pool.query(
                    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'
                )
            ).rows[0].count
        ).toBe(1)
    })
})
