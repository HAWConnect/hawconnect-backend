import { createClubsRepository } from '@/admin/clubs'
import { accountRuntime } from '@/lib/account-runtime'
import { createClubDirectory } from './club-directory'

const repository = accountRuntime
    ? createClubsRepository(accountRuntime.pool)
    : null
export const hawClubs = createClubDirectory(
    repository ? () => repository.list() : null
)
