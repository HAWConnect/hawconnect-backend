import { readFile } from 'node:fs/promises'
import { validateQuickLinks } from '@/admin/quick-links'
import seed from '@/data/initial-quick-links.json'
import { accountRuntime } from '@/lib/account-runtime'

if (!accountRuntime) throw Error('AccountConfigurationRequired')
const client = await accountRuntime.pool.connect()
try {
    await client.query('BEGIN')
    await client.query(
        await readFile(new URL('./quick-links.sql', import.meta.url), 'utf8')
    )
    await client.query(
        'INSERT INTO haw_quick_links(id,links,version) VALUES(1,$1::jsonb,$2) ON CONFLICT(id) DO NOTHING',
        [JSON.stringify(validateQuickLinks(seed)), crypto.randomUUID()]
    )
    await client.query('COMMIT')
    console.info('Quick Links migration complete; existing directory preserved')
} catch (error) {
    await client.query('ROLLBACK')
    throw error
} finally {
    client.release()
    await accountRuntime.pool.end()
}
