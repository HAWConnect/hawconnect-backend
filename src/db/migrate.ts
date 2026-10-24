import { CONNECTION_STRING } from '.'
import { runProjectMigrations } from './run-migrations'

try {
    await runProjectMigrations(CONNECTION_STRING)
    console.info('HAWConnect migrations complete')
} catch (error) {
    console.error(
        error instanceof Error &&
            error.message === 'ExistingDatabaseRequiresMigrationAdoption'
            ? 'ExistingDatabaseRequiresMigrationAdoption: existing data/history needs a reviewed adoption plan; no migration was applied.'
            : 'Migration failed. Verify the database target, baseline and connectivity; credentials are not logged.'
    )
    process.exitCode = 1
}
