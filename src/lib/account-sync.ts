import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { SyncCrypto } from '@/utils/sync-crypto'
import {
    type SyncRecord,
    validateSyncOperations
} from '@/utils/sync-validation'

interface Receipt {
    entityId: string
    kind: string
    revision: number
    conflict: boolean
}
export function createAccountSync(pool: Pool, crypto: SyncCrypto) {
    const scope = (owner: string, kind: string, id: string) =>
        JSON.stringify([owner, kind, id])
    async function snapshotFrom(
        client: Pool | PoolClient,
        userId: string
    ): Promise<{ records: SyncRecord[] }> {
        const rows = await client.query(
            'SELECT * FROM haw_sync_record WHERE user_id=$1 ORDER BY kind,entity_id',
            [userId]
        )
        return {
            records: rows.rows.map((r) => ({
                kind: r.kind,
                entityId: r.entity_id,
                revision: Number(r.revision),
                deleted: r.deleted,
                payload: r.deleted
                    ? null
                    : crypto.open(
                          scope(userId, r.kind, r.entity_id),
                          r.ciphertext
                      )
            }))
        }
    }
    async function apply(userId: string, input: unknown) {
        if (!userId) throw new Error('SignInRequired')
        const operations = validateSyncOperations(input)
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const user = await client.query(
                'SELECT id FROM haw_user WHERE id=$1 FOR UPDATE',
                [userId]
            )
            if (!user.rowCount) throw new Error('SignInRequired')
            const conflicts: Receipt[] = []
            for (const op of operations) {
                const hash = createHash('sha256')
                    .update(JSON.stringify(op))
                    .digest('hex')
                const prior = await client.query(
                    'SELECT request_hash,result FROM haw_sync_receipt WHERE user_id=$1 AND operation_id=$2',
                    [userId, op.operationId]
                )
                if (prior.rowCount) {
                    if (prior.rows[0].request_hash !== hash)
                        throw new Error('OperationReplayMismatch')
                    if (prior.rows[0].result.conflict)
                        conflicts.push(prior.rows[0].result)
                    continue
                }
                const current = await client.query(
                    'SELECT revision,deleted FROM haw_sync_record WHERE user_id=$1 AND kind=$2 AND entity_id=$3',
                    [userId, op.kind, op.entityId]
                )
                const row = current.rows[0]
                const revision = row ? Number(row.revision) : 0
                const conflict =
                    op.kind === 'calendar' &&
                    (op.baseRevision !== revision ||
                        (row?.deleted && !op.deleted))
                const receipt: Receipt = {
                    entityId: op.entityId,
                    kind: op.kind,
                    revision: conflict ? revision : revision + 1,
                    conflict: Boolean(conflict)
                }
                if (conflict) conflicts.push(receipt)
                else
                    await client.query(
                        `INSERT INTO haw_sync_record(user_id,kind,entity_id,revision,deleted,ciphertext) VALUES($1,$2,$3,$4,$5,$6)
                    ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=EXCLUDED.revision,deleted=EXCLUDED.deleted,ciphertext=EXCLUDED.ciphertext,updated_at=now()`,
                        [
                            userId,
                            op.kind,
                            op.entityId,
                            revision + 1,
                            op.deleted,
                            op.deleted
                                ? null
                                : crypto.seal(
                                      scope(userId, op.kind, op.entityId),
                                      op.payload
                                  )
                        ]
                    )
                await client.query(
                    'INSERT INTO haw_sync_receipt(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4)',
                    [userId, op.operationId, hash, JSON.stringify(receipt)]
                )
            }
            const quota = await client.query(
                'SELECT count(*) AS count,coalesce(sum(octet_length(ciphertext)),0) AS size FROM haw_sync_record WHERE user_id=$1',
                [userId]
            )
            if (
                Number(quota.rows[0].count) > 512 ||
                Number(quota.rows[0].size) > 28_000_000
            )
                throw new Error('AccountStorageLimit')
            const result = {
                ...(await snapshotFrom(client, userId)),
                conflicts
            }
            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }
    return {
        apply,
        snapshot: async (userId: string) => {
            if (!userId) throw new Error('SignInRequired')
            return snapshotFrom(pool, userId)
        }
    }
}
