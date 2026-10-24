import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createAccountSync } from '../../lib/account-sync'
import { createSyncCrypto } from '../sync-crypto'

const url = process.env.HAWCONNECT_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('isolated account sync (PostgreSQL)', () => {
    const pool = new Pool({ connectionString: url })
    const crypto = createSyncCrypto(Buffer.alloc(32, 9).toString('base64'))
    const service = createAccountSync(pool, crypto)
    const userA = `sync-a-${globalThis.crypto.randomUUID()}`
    const userB = `sync-b-${globalThis.crypto.randomUUID()}`
    const raw =
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261023T090000Z\r\nSUMMARY:Private lesson\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const payload = {
        name: 'My calendar',
        raw,
        eventCount: 1,
        defaultTimeZone: 'Europe/Berlin',
        sourceType: 'file',
        updatedAt: '2026-10-23T10:00:00Z'
    }
    const op = (entityId: string, baseRevision = 0, deleted = false) => ({
        operationId: globalThis.crypto.randomUUID(),
        kind: 'calendar' as const,
        entityId,
        baseRevision,
        deleted,
        payload: deleted ? null : payload
    })
    beforeAll(async () => {
        await pool.query(
            await readFile(
                new URL('../../db/accounts/sync.sql', import.meta.url),
                'utf8'
            )
        )
        for (const id of [userA, userB])
            await pool.query(
                'INSERT INTO haw_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,now(),now())',
                [id, `${id}@haw-hamburg.de`]
            )
    })
    afterAll(async () => {
        await pool.query('DELETE FROM haw_user WHERE id = ANY($1)', [
            [userA, userB]
        ])
        await pool.end()
    })
    it('isolates owners and encrypts stored calendar content', async () => {
        await service.apply(userA, [op('first')])
        expect((await service.snapshot(userA)).records).toHaveLength(1)
        expect((await service.snapshot(userB)).records).toHaveLength(0)
        const stored = await pool.query(
            'SELECT ciphertext FROM haw_sync_record WHERE user_id=$1',
            [userA]
        )
        expect(stored.rows[0].ciphertext).not.toContain('Private lesson')
    })
    it('makes retries idempotent and rejects changed replay payloads', async () => {
        const operation = op('retry')
        await service.apply(userA, [operation])
        await service.apply(userA, [operation])
        const row = (await service.snapshot(userA)).records.find(
            (r) => r.entityId === 'retry'
        )
        expect(row?.revision).toBe(1)
        await expect(
            service.apply(userA, [
                { ...operation, payload: { ...payload, name: 'changed' } }
            ])
        ).rejects.toThrow('OperationReplayMismatch')
    })
    it('retains the newer version after a stale update and deletion', async () => {
        await service.apply(userA, [op('delete')])
        await service.apply(userA, [op('delete', 1, true)])
        const result = await service.apply(userA, [op('delete', 1)])
        expect(result.conflicts).toHaveLength(1)
        const row = (await service.snapshot(userA)).records.find(
            (r) => r.entityId === 'delete'
        )
        expect(row?.deleted).toBe(true)
        expect(row?.payload).toBeNull()
    })
    it('serialises simultaneous calendar edits with one conflict', async () => {
        await service.apply(userA, [op('race')])
        const results = await Promise.all([
            service.apply(userA, [op('race', 1)]),
            service.apply(userA, [op('race', 1)])
        ])
        expect(results.flatMap((r) => r.conflicts)).toHaveLength(1)
    })
    it('rejects invalid payloads atomically', async () => {
        await expect(
            service.apply(userB, [
                op('valid'),
                { ...op('invalid'), payload: { raw: 'not a calendar' } }
            ])
        ).rejects.toThrow('InvalidSyncPayload')
        expect((await service.snapshot(userB)).records).toHaveLength(0)
    })
})
