import { expect, test } from 'bun:test'
import { validateLegalDraft, validateLegalPublication } from '../legal'

test('legal drafts allow incomplete text but publications require both languages', () => {
    const draft = validateLegalDraft({
        mode: 'internal',
        body: { de: 'Datenschutz', en: '' }
    })
    expect(draft.body.de).toBe('Datenschutz')
    expect(() => validateLegalPublication(draft)).toThrow('InvalidInput')
    expect(
        validateLegalPublication({
            ...draft,
            body: { de: 'Deutsch', en: 'English' }
        }).mode
    ).toBe('internal')
})
test('external legal publication requires safe HTTPS destinations in both languages', () => {
    const draft = validateLegalDraft({
        mode: 'external',
        url: {
            de: 'https://example.org/datenschutz',
            en: 'https://example.org/privacy'
        }
    })
    expect(validateLegalPublication(draft).url.en).toBe(
        'https://example.org/privacy'
    )
    for (const url of [
        'javascript:alert(1)',
        'http://example.org',
        'https://user:pass@example.org'
    ])
        expect(() =>
            validateLegalDraft({ mode: 'external', url: { de: url } })
        ).toThrow('InvalidInput')
})
test('legal validation rejects oversized and malformed values', () => {
    for (const value of [
        null,
        [],
        { mode: 'other' },
        { mode: 'internal', body: { de: 'a'.repeat(20001) } },
        { mode: 'internal', body: [] }
    ])
        expect(() => validateLegalDraft(value)).toThrow('InvalidInput')
})

test('external publication never leaks inactive draft text', () => {
    const result = validateLegalPublication({
        mode: 'external',
        body: { de: 'Private draft', en: 'Private draft' },
        url: { de: 'https://example.org/de', en: 'https://example.org/en' }
    })
    expect(result.body).toEqual({ de: '', en: '' })
})
