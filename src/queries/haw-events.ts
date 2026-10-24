import { publicClubEvents } from '@/admin/public-events'
import { accountRuntime } from '@/lib/account-runtime'
import { hawEventsService } from '@/utils/haw-events'
export async function hawEvents(_: unknown, args: { language?: string }) {
    const snapshot = await hawEventsService.get()
    let managedAvailable = false
    let managed: Awaited<ReturnType<typeof publicClubEvents>> = []
    if (accountRuntime)
        try {
            managed = await publicClubEvents(
                accountRuntime.pool,
                args.language ?? 'de'
            )
            managedAvailable = true
        } catch {
            /* Do not log database details. */
        }
    const events = [
        ...snapshot.events.map((e) => ({ ...e, origin: 'HAW' })),
        ...managed
    ].sort((a, b) =>
        (a.startTime ?? a.date).localeCompare(b.startTime ?? b.date)
    )
    return {
        ...snapshot,
        events,
        managedAvailable,
        available: snapshot.available || managed.length > 0
    }
}
