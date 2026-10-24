import { expect, test } from 'bun:test'
import { organizerId, validateOrganizer } from '../organizers'

test('organizer validation preserves bilingual text and unknown association status', () => {
    const result = validateOrganizer({
        name: ' Example ',
        description: { de: 'Deutsch', en: 'English' },
        website: 'https://example.org'
    })
    expect(result.name).toBe('Example')
    expect(result.description.en).toBe('English')
    expect(result.nonProfit).toBeNull()
    expect(organizerId(' Example ')).toBe(organizerId('EXAMPLE'))
})
test('organizer validation rejects unsafe links and invalid fields', () => {
    expect(() =>
        validateOrganizer({ name: 'Example', website: 'javascript:alert(1)' })
    ).toThrow('InvalidInput')
    expect(() =>
        validateOrganizer({
            name: 'Example',
            website: 'https://user:pass@example.org'
        })
    ).toThrow('InvalidInput')
    expect(() =>
        validateOrganizer({ name: 'Example', nonProfit: 'yes' })
    ).toThrow('InvalidInput')
})
