import { describe, expect, test } from 'bun:test'
import { parseHawClubs } from '../haw-clubs'

const html = (language: string) =>
    `<div class="accordion">${[1, 2, 3].map((id) => `<div class="card"><div class="card-header" id="heading-${id}"><a class="acc-headline">${language} Club ${id}</a></div><div class="card-body"><p>${language} description</p><p><a href="https://example.org/${id}">Website</a><a href="javascript:alert(1)">Unsafe</a><a href="mailto:club@example.org">Contact</a></p><script>unsafe()</script></div></div>`).join('')}</div>`
describe('HAW clubs source parser', () => {
    test('uses source language, stable anchors and safe contact links', () => {
        for (const language of ['de', 'en'] as const) {
            const clubs = parseHawClubs(html(language), language)
            expect(clubs).toHaveLength(3)
            expect(clubs[0].title).toBe(`${language} Club 1`)
            expect(clubs[0].description).toContain(`${language} description`)
            expect(clubs[0].description).not.toContain('unsafe()')
            expect(clubs[0].sourceUrl).toEndWith('#heading-1')
            expect(clubs[0].links).toHaveLength(2)
        }
    })
    test('rejects changed markup and duplicate source identities', () => {
        expect(() => parseHawClubs('<main>Unavailable</main>', 'en')).toThrow(
            'InvalidHawClubsSource'
        )
        expect(() =>
            parseHawClubs(html('en').replaceAll('heading-2', 'heading-1'), 'en')
        ).toThrow('InvalidHawClubsSource')
    })
})
