import { readFile } from 'node:fs/promises'
import { accountRuntime } from '@/lib/account-runtime'

if (!accountRuntime) throw Error('AccountConfigurationRequired')
try {
    await accountRuntime.pool.query(
        await readFile(
            new URL('./legal-documents.sql', import.meta.url),
            'utf8'
        )
    )
    console.info('Legal documents migration complete')
} finally {
    await accountRuntime.pool.end()
}
