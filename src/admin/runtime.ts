import { createAccountAuth } from '@/lib/account-auth'
import { createAccountMailer } from '@/lib/account-mail'
import { accountRuntime } from '@/lib/account-runtime'
import { academicCalendarService } from '@/utils/academic-calendar'
import { hamburgFoodService } from '@/utils/food-refresh'
import { hawEventsService } from '@/utils/haw-events'
import { adminEmail } from './policy'
import { createAdminRepository } from './repository'
import type { AdminDependencies } from './router'
export function createAdminRuntime(): AdminDependencies | null {
    if (!accountRuntime || !process.env.HAWCONNECT_DASH_ORIGIN) return null
    const origin = new URL(process.env.HAWCONNECT_DASH_ORIGIN).origin
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
        throw Error('HTTPSRequired')
    const bootstrap = (process.env.HAWCONNECT_ADMIN_EMAILS ?? '')
        .split(',')
        .filter((x) => x.trim())
        .map(adminEmail)
    return {
        origin,
        repository: createAdminRepository(accountRuntime.pool, bootstrap),
        auth: createAccountAuth({
            pool: accountRuntime.pool,
            passwordLogin: true,
            secret: process.env.HAWCONNECT_ACCOUNT_SECRET ?? '',
            baseURL: process.env.HAWCONNECT_AUTH_ORIGIN ?? '',
            webOrigin: origin,
            send: createAccountMailer(process.env)
        }),
        status: async () => {
            const names = ['Food', 'Semesterzeiten', 'HAW Events']
            const services = await Promise.allSettled([
                hamburgFoodService.get(),
                academicCalendarService.get(),
                hawEventsService.get()
            ])
            return services.map((r, i) => {
                if (r.status === 'rejected')
                    return {
                        name: names[i],
                        available: false,
                        stale: true,
                        updatedAt: null
                    }
                const v = r.value
                return {
                    name: names[i],
                    available: v.available,
                    stale: v.stale,
                    updatedAt: v.updatedAt
                }
            })
        }
    }
}
