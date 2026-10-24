import { hashPassword } from 'better-auth/crypto'
import type { Pool } from 'pg'
import { adminEmail } from './policy'
import type { AdminRepository } from './repository'

/** Operator-only provisioning; never exposed as a public signup/reset endpoint. */
export async function setAdminPassword(
    pool: Pool,
    repository: AdminRepository,
    email: string,
    password: string
) {
    const address = adminEmail(email)
    if (
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 128
    )
        throw Error('InvalidAdminPassword')
    if (!(await repository.grants(address)).length) throw Error('AdminRequired')
    const hash = await hashPassword(password)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await client.query(
            'SELECT id,"emailVerified" FROM haw_user WHERE email=$1 FOR UPDATE',
            [address]
        )
        const user = result.rows[0]
        if (!user?.emailVerified) throw Error('VerifiedAdminAccountRequired')
        const account = await client.query(
            'SELECT id FROM haw_account WHERE "userId"=$1 AND "providerId"=$2',
            [user.id, 'credential']
        )
        if (account.rowCount && account.rowCount > 1)
            throw Error('InvalidCredentialState')
        if (account.rows[0])
            await client.query(
                'UPDATE haw_account SET password=$1,"updatedAt"=now() WHERE id=$2',
                [hash, account.rows[0].id]
            )
        else
            await client.query(
                'INSERT INTO haw_account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,$3,$2,$4,now(),now())',
                [crypto.randomUUID(), user.id, 'credential', hash]
            )
        await client.query('DELETE FROM haw_session WHERE "userId"=$1', [
            user.id
        ])
        await client.query(
            'INSERT INTO audit_log(entity,entity_id,operation,name,user_id,created_at) VALUES($1,NULL,$2,$3,$4,now())',
            ['haw_account', 'password-set', address, 'operator:admin-password']
        )
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}
