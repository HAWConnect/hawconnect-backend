import { describe, expect, it } from 'bun:test'
import { createSyncCrypto } from '../sync-crypto'

describe('private sync encryption', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    it('round trips without exposing plaintext in ciphertext', () => {
        const crypto = createSyncCrypto(key)
        const sealed = crypto.seal('user-a:calendar:one', {
            raw: 'private calendar',
            privateLink: 'https://example.test/private'
        })
        expect(sealed).not.toContain('private')
        expect(crypto.open('user-a:calendar:one', sealed)).toEqual({
            raw: 'private calendar',
            privateLink: 'https://example.test/private'
        })
        expect(
            crypto.seal('user-a:calendar:one', { raw: 'private calendar' })
        ).not.toBe(sealed)
    })
    it('rejects cross-user copies, tampering and wrong keys', () => {
        const crypto = createSyncCrypto(key)
        const sealed = crypto.seal('user-a:calendar:one', { raw: 'secret' })
        expect(() => crypto.open('user-b:calendar:one', sealed)).toThrow(
            'InvalidEncryptedRecord'
        )
        expect(() => crypto.open('user-a:calendar:one', sealed + 'x')).toThrow(
            'InvalidEncryptedRecord'
        )
        expect(() =>
            createSyncCrypto(Buffer.alloc(32, 8).toString('base64')).open(
                'user-a:calendar:one',
                sealed
            )
        ).toThrow('InvalidEncryptedRecord')
    })
    it('requires an explicitly configured 256-bit key', () => {
        for (const key of ['', 'short', Buffer.alloc(16).toString('base64')])
            expect(() => createSyncCrypto(key)).toThrow(
                'SyncEncryptionKeyRequired'
            )
    })
})
