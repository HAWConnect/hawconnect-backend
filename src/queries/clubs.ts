import type { ClClub } from '@/types/clEvents'

/** Retired contract; current club information is served by hawClubs. */
export async function clClubs(): Promise<ClClub[]> {
    return []
}
