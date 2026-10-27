import { describe, expect, test } from 'bun:test'
import { validateQuickLinks } from '../quick-links'

const link = {
    key: 'moodle',
    title: { de: 'Moodle', en: 'Moodle' },
    url: {
        de: 'https://moodle.haw-hamburg.de/?lang=de',
        en: 'https://moodle.haw-hamburg.de/?lang=en'
    },
    icon: 'FolderOpen',
    visible: true
}
describe('managed quick links', () => {
    test('preserves bilingual URLs, visibility and order', () => {
        expect(
            validateQuickLinks([
                link,
                { ...link, key: 'hidden', visible: false }
            ])
        ).toEqual([link, { ...link, key: 'hidden', visible: false }])
        expect(validateQuickLinks([])).toEqual([])
    })
    test('rejects duplicate IDs and unrecognized icons', () => {
        expect(() => validateQuickLinks([link, link])).toThrow('InvalidInput')
        expect(() =>
            validateQuickLinks([{ ...link, icon: 'anything' }])
        ).toThrow('InvalidInput')
    })
    test('rejects unsafe URLs and missing translations', () => {
        for (const url of [
            'javascript:alert(1)',
            'http://example.com',
            'https://user:password@example.com',
            '//example.com'
        ])
            expect(() =>
                validateQuickLinks([{ ...link, url: { de: url, en: url } }])
            ).toThrow('InvalidInput')
        expect(() =>
            validateQuickLinks([{ ...link, title: { de: 'Moodle', en: '' } }])
        ).toThrow('InvalidInput')
        expect(() => validateQuickLinks([{ ...link, visible: 'yes' }])).toThrow(
            'InvalidInput'
        )
    })
})
