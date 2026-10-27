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

test('rich legal text sanitizes formatting and derives authoritative plaintext', () => {
    const html =
        '<h2>Heading</h2><p><strong>Legal</strong><script>evil()</script><style>bad</style><img src="https://example.org/a"><a href="https://example.org" onclick="evil()"> Link</a><a href="mailto:test@example.org"> Mail</a><a href="https://u:p@example.org"> Unsafe</a></p>'
    const draft = validateLegalDraft({
        mode: 'internal',
        body: { de: 'Spoof', en: 'Spoof' },
        bodyHtml: { de: html, en: '<p>English</p>' }
    })
    expect(draft.body.de).toBe('Heading\nLegal Link Mail Unsafe')
    expect(draft.body.en).toBe('English')
    expect(draft.bodyHtml?.de).toContain('<strong>Legal</strong>')
    expect(draft.bodyHtml?.de).toContain('mailto:test@example.org')
    for (const unsafe of ['script', 'style', '<img', 'onclick', 'u:p@'])
        expect(draft.bodyHtml?.de).not.toContain(unsafe)
})
test('rich publication rejects empty formatting, hidden scripts and invisible text', () => {
    for (const empty of [
        '<p><br></p>',
        '<script>hidden</script>',
        '<img src="https://example.org/a">',
        '<p>&nbsp;&#8203;&#65279;</p>'
    ])
        expect(() =>
            validateLegalPublication({
                mode: 'internal',
                body: { de: 'Spoof', en: 'Spoof' },
                bodyHtml: { de: empty, en: '<p>English</p>' }
            })
        ).toThrow('InvalidInput')
})
test('legacy legal content remains literal and optional null HTML stays plain', () => {
    const legacy = {
        mode: 'internal',
        body: {
            de: '<script>literal</script>',
            en: 'a < b and <strong>literal</strong>'
        }
    }
    expect(validateLegalPublication(legacy).body).toEqual(legacy.body)
    expect(validateLegalDraft({ ...legacy, bodyHtml: null }).body).toEqual(
        legacy.body
    )
    expect(validateLegalPublication(legacy)).not.toHaveProperty('bodyHtml')
})
test('external publications omit inactive rich text entirely and HTML limits apply', () => {
    const draft = {
        mode: 'external',
        bodyHtml: { de: '<p>Hidden DE</p>', en: '<p>Hidden EN</p>' },
        url: { de: 'https://example.org/de', en: 'https://example.org/en' }
    }
    const publication = validateLegalPublication(draft)
    expect(publication.body).toEqual({ de: '', en: '' })
    expect(publication).not.toHaveProperty('bodyHtml')
    expect(() =>
        validateLegalDraft({
            ...draft,
            bodyHtml: { de: 'x'.repeat(20001), en: '' }
        })
    ).toThrow('InvalidInput')
})

test('normalized legal HTML is bounded before saving even when entities expand', () => {
    const bodyHtml = { de: `<p>${'&'.repeat(5000)}</p>`, en: '<p>English</p>' }
    expect(() => validateLegalDraft({ mode: 'internal', bodyHtml })).toThrow(
        'InvalidInput'
    )
})
test('legacy literal whitespace remains intact in drafts but cannot publish', () => {
    const draft = { mode: 'internal', body: { de: ' \t\n ', en: 'English' } }
    expect(validateLegalDraft(draft).body.de).toBe(draft.body.de)
    expect(() => validateLegalPublication(draft)).toThrow('InvalidInput')
})
