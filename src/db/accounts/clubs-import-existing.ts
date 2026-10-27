import { readFile } from 'node:fs/promises'
import { importExistingClubs, validateClubImport } from '@/admin/clubs-import'

try {
    const args = process.argv.slice(2)
    if (args.length > 1 || (args.length && args[0] !== '--apply'))
        throw Error('InvalidClubImportArguments')
    const seed = validateClubImport(
        JSON.parse(
            await readFile(
                new URL('../../data/initial-clubs.json', import.meta.url),
                'utf8'
            )
        )
    )
    if (!args.includes('--apply')) {
        console.info(
            JSON.stringify({
                mode: 'dry-run',
                importKey: seed.importKey,
                clubs: seed.clubs.length,
                translations: seed.clubs.length * 2,
                databaseAccessed: false
            })
        )
    } else {
        // Never initialize account configuration or open a database in dry-run mode.
        const { accountRuntime } = await import('@/lib/account-runtime')
        if (!accountRuntime) throw Error('AccountConfigurationRequired')
        try {
            console.info(
                JSON.stringify({
                    mode: 'apply',
                    ...(await importExistingClubs(accountRuntime.pool, seed))
                })
            )
        } finally {
            await accountRuntime.pool.end()
        }
    }
} catch (error) {
    const safe = [
        'InvalidClubImportArguments',
        'InvalidClubImport',
        'AccountConfigurationRequired',
        'ClubImportFailed'
    ]
    const code =
        error instanceof Error && safe.includes(error.message)
            ? error.message
            : 'ClubImportFailed'
    console.error(code)
    process.exitCode = 1
}
