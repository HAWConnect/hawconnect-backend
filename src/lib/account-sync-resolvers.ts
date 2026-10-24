import { GraphQLError } from 'graphql'
import type { createAccountSync } from './account-sync'
export function createAccountSyncResolvers(
    service: ReturnType<typeof createAccountSync> | null
) {
    function owner(context: { accountUserId?: string }) {
        if (!context.accountUserId)
            throw new GraphQLError('SignInRequired', {
                extensions: { code: 'UNAUTHENTICATED' }
            })
        if (!service) throw new GraphQLError('AccountSyncUnavailable')
        return { id: context.accountUserId, sync: service }
    }
    const records = (rows: { payload: unknown }[]) =>
        rows.map(({ payload, ...row }) => ({
            ...row,
            payloadJson: JSON.stringify(payload)
        }))
    return {
        async accountSnapshot(
            _: unknown,
            _args: unknown,
            context: { accountUserId?: string }
        ) {
            const { id, sync } = owner(context)
            try {
                const result = await sync.snapshot(id)
                return { records: records(result.records) }
            } catch {
                throw new GraphQLError('AccountSyncUnavailable')
            }
        },
        async accountSync(
            _: unknown,
            args: { operations: { payloadJson: string }[] },
            context: { accountUserId?: string }
        ) {
            const { id, sync } = owner(context)
            try {
                if (args.operations.length > 20)
                    throw new Error('InvalidSyncPayload')
                const operations = args.operations.map(
                    ({ payloadJson, ...operation }) => ({
                        ...operation,
                        payload: JSON.parse(payloadJson)
                    })
                )
                const result = await sync.apply(id, operations)
                return { ...result, records: records(result.records) }
            } catch (error) {
                const allowed = [
                    'InvalidSyncPayload',
                    'OperationReplayMismatch',
                    'AccountStorageLimit'
                ]
                throw new GraphQLError(
                    error instanceof Error && allowed.includes(error.message)
                        ? error.message
                        : 'AccountSyncUnavailable'
                )
            }
        }
    }
}
