import { expect, test } from 'bun:test'
import { adminEmail, capabilitiesFor, requireCapability } from '../policy'

test('only HAW addresses with explicit grants have admin access', () => {
    expect(adminEmail(' Maintainer@haw-hamburg.de ')).toBe(
        'maintainer@haw-hamburg.de'
    )
    for (const email of [
        'info@edunavi.de',
        'user@haw-hamburg.de.evil',
        'user@sub.haw-hamburg.de'
    ])
        expect(() => adminEmail(email)).toThrow()
    expect(capabilitiesFor('student@haw-hamburg.de', [], [])).toEqual([])
    expect(
        capabilitiesFor('admin@haw-hamburg.de', ['admin@haw-hamburg.de'], [])
    ).toEqual(['admin'])
    expect(() => requireCapability(['announcements'], 'admin')).toThrow(
        'Forbidden'
    )
    expect(() => requireCapability(['admin'], 'events')).not.toThrow()
})
