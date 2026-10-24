import { accountRuntime } from '@/lib/account-runtime'
import { createAccountSync } from '@/lib/account-sync'
import { createAccountSyncResolvers } from '@/lib/account-sync-resolvers'
import { createSyncCrypto } from '@/utils/sync-crypto'

const service =
    accountRuntime && process.env.HAWCONNECT_SYNC_ENCRYPTION_KEY
        ? createAccountSync(
              accountRuntime.pool,
              createSyncCrypto(process.env.HAWCONNECT_SYNC_ENCRYPTION_KEY)
          )
        : null
export const { accountSnapshot, accountSync } =
    createAccountSyncResolvers(service)
