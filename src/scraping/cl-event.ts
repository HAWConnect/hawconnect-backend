import type { ClEvent } from '@/types/clEvents'

/** Retired remote feed; managed events are served by campusLifeEvents. */
export default async function getClEvents(): Promise<ClEvent[]> {
    return []
}
