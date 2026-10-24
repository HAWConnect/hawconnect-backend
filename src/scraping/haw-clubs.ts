import { load } from 'cheerio'
export const HAW_CLUBS_SOURCES = {
    de: 'https://www.haw-hamburg.de/studium/campusleben/studentische-projekte/',
    en: 'https://www.haw-hamburg.de/en/study/campus-life/student-projects/'
} as const
export interface HawClub {
    id: string
    title: string
    description: string
    sourceUrl: string
    links: { title: string; url: string }[]
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
export function parseHawClubs(html: string, language: 'de' | 'en'): HawClub[] {
    const $ = load(html)
    const clubs: HawClub[] = []
    $('.accordion .card').each((_, element) => {
        const card = $(element)
        const heading = card.find('.card-header').first()
        const title = clean(heading.find('.acc-headline').text())
        const anchor = heading.attr('id')
        if (!title || !anchor) return
        const body = card.find('.card-body').first().clone()
        body.find('script,style').remove()
        const links: HawClub['links'] = []
        body.find('a[href]').each((_, link) => {
            try {
                const url = new URL(
                    $(link).attr('href') ?? '',
                    HAW_CLUBS_SOURCES[language]
                )
                const title = clean($(link).text())
                if (
                    !['https:', 'mailto:'].includes(url.protocol) ||
                    url.username ||
                    url.password ||
                    !title
                )
                    return
                if (!links.some((item) => item.url === url.href))
                    links.push({ title, url: url.href })
            } catch {
                /* Ignore malformed source links. */
            }
        })
        const paragraphs = body
            .find('p')
            .map((_, paragraph) => clean($(paragraph).text()))
            .get()
        clubs.push({
            id: anchor,
            title,
            description: paragraphs
                .filter(
                    (text) =>
                        text &&
                        !/^(More information|Weitere Informationen|Mehr Informationen)$/i.test(
                            text
                        )
                )
                .join('\n\n'),
            sourceUrl: `${HAW_CLUBS_SOURCES[language]}#${anchor}`,
            links
        })
    })
    if (
        clubs.length < 3 ||
        clubs.length > 100 ||
        new Set(clubs.map((club) => club.id)).size !== clubs.length
    )
        throw Error('InvalidHawClubsSource')
    return clubs
}
