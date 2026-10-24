import { Pool } from 'pg'
import { createAccountAuth } from './account-auth'
import { createAccountMailer } from './account-mail'

export function createAccountRuntime(env: NodeJS.ProcessEnv = process.env) {
    if (
        !env.HAWCONNECT_ACCOUNTS_DATABASE_URL ||
        !env.HAWCONNECT_ACCOUNT_SECRET ||
        !env.HAWCONNECT_AUTH_ORIGIN ||
        !env.HAWCONNECT_WEB_ORIGIN
    )
        return null
    const authOrigin = new URL(env.HAWCONNECT_AUTH_ORIGIN)
    const webOrigin = new URL(env.HAWCONNECT_WEB_ORIGIN)
    if (
        env.NODE_ENV === 'production' &&
        (authOrigin.protocol !== 'https:' || webOrigin.protocol !== 'https:')
    )
        throw new Error('HTTPSRequired')
    const pool = new Pool({
        connectionString: env.HAWCONNECT_ACCOUNTS_DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 10000
    })
    return {
        ...createAccountAuth({
            pool,
            secret: env.HAWCONNECT_ACCOUNT_SECRET,
            baseURL: authOrigin.origin,
            webOrigin: webOrigin.origin,
            send: createAccountMailer(env)
        }),
        pool
    }
}
export const accountRuntime = createAccountRuntime()
