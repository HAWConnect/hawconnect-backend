import { readFileSync } from 'node:fs'
import { accountRuntime } from '@/lib/account-runtime'
import { setAdminPassword } from './password'
import { createAdminRuntime } from './runtime'

const runtime = createAdminRuntime()
if (!runtime || !accountRuntime) throw Error('AdminConfigurationRequired')
if (process.stdin.isTTY)
    throw Error(
        'Provide the password through standard input, never as a command argument.'
    )
const email = process.argv[2]
if (!email)
    throw Error(
        'Usage: bun run admin:set-password email@haw-hamburg.de < password-input'
    )
const bytes = readFileSync(0)
try {
    const password = bytes.toString('utf8').replace(/\r?\n$/, '')
    await setAdminPassword(
        accountRuntime.pool,
        runtime.repository,
        email,
        password
    )
    console.info(
        'Admin password updated. Existing account sessions were revoked.'
    )
} catch (e) {
    console.error(
        e instanceof Error &&
            [
                'AdminRequired',
                'VerifiedAdminAccountRequired',
                'InvalidAdminPassword',
                'InvalidAdminEmail'
            ].includes(e.message)
            ? e.message
            : 'AdminPasswordSetupFailed'
    )
    process.exitCode = 1
} finally {
    bytes.fill(0)
    await accountRuntime.pool.end()
}
