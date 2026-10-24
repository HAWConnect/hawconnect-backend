import { describe, expect, it } from 'bun:test'
import { normaliseAccountEmail } from '../account-policy'

describe('HAWConnect account domain policy', () => {
    it('normalises a university mailbox without requiring student status', () => {
        expect(normaliseAccountEmail('  Example.Name@HAW-HAMBURG.DE  ')).toBe(
            'example.name@haw-hamburg.de'
        )
    })
    it('rejects lookalike and alternate domains', () => {
        for (const value of [
            'a@haw-hamburg.de.evil.test',
            'a@sub.haw-hamburg.de',
            'a@haw-hamburg.com',
            'a@hаw-hamburg.de',
            'a@students.haw-hamburg.de'
        ]) {
            expect(() => normaliseAccountEmail(value)).toThrow(
                'InvalidAccountEmail'
            )
        }
    })
    it('rejects malformed input and header injection', () => {
        for (const value of [
            '',
            '@haw-hamburg.de',
            'a@@haw-hamburg.de',
            'a b@haw-hamburg.de',
            'a\r\nBcc:x@test.com@haw-hamburg.de',
            '.a@haw-hamburg.de',
            'a..b@haw-hamburg.de'
        ]) {
            expect(() => normaliseAccountEmail(value)).toThrow(
                'InvalidAccountEmail'
            )
        }
    })
})
