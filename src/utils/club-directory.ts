import { type ClubRow, managedClubs } from '@/admin/clubs'

const sourceUrl = 'https://hawconnect.de/clubs'
export function managedDirectory(rows: ClubRow[], language: 'de' | 'en') {
    const dates = rows
        .map((row) =>
            row.updated_at ? new Date(row.updated_at).getTime() : Number.NaN
        )
        .filter(Number.isFinite)
    return {
        clubs: managedClubs(rows, language),
        available: true,
        stale: false,
        updatedAt: dates.length
            ? new Date(Math.max(...dates)).toISOString()
            : null,
        sourceUrl
    }
}
export function createClubDirectory(
    content: (() => Promise<ClubRow[]>) | null
) {
    const cached = new Map<string, ReturnType<typeof managedDirectory>>()
    return async (language = 'de') => {
        const locale = language === 'en' ? 'en' : 'de'
        const unavailable = {
            clubs: [],
            available: false,
            stale: true,
            updatedAt: null,
            sourceUrl
        }
        if (!content) return unavailable
        try {
            const directory = managedDirectory(await content(), locale)
            cached.set(locale, directory)
            return directory
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'ClubsSetupRequired'
            )
                return unavailable
            console.warn(
                'HAW clubs content unavailable; retaining last managed directory'
            )
            return { ...(cached.get(locale) ?? unavailable), stale: true }
        }
    }
}
