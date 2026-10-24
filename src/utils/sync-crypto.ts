import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function createSyncCrypto(encodedKey: string) {
    const key = Buffer.from(encodedKey, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encodedKey)
        throw new Error('SyncEncryptionKeyRequired')
    return {
        seal(scope: string, value: unknown): string {
            const nonce = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, nonce)
            cipher.setAAD(Buffer.from(scope))
            const encrypted = Buffer.concat([
                cipher.update(JSON.stringify(value), 'utf8'),
                cipher.final()
            ])
            return [
                'v1',
                nonce.toString('base64url'),
                encrypted.toString('base64url'),
                cipher.getAuthTag().toString('base64url')
            ].join('.')
        },
        open(scope: string, encoded: string): unknown {
            try {
                const parts = encoded.split('.')
                if (parts.length !== 4 || parts[0] !== 'v1') throw new Error()
                const nonce = Buffer.from(parts[1], 'base64url')
                const tag = Buffer.from(parts[3], 'base64url')
                if (nonce.length !== 12 || tag.length !== 16) throw new Error()
                const decipher = createDecipheriv('aes-256-gcm', key, nonce)
                decipher.setAAD(Buffer.from(scope))
                decipher.setAuthTag(tag)
                return JSON.parse(
                    Buffer.concat([
                        decipher.update(Buffer.from(parts[2], 'base64url')),
                        decipher.final()
                    ]).toString('utf8')
                )
            } catch {
                throw new Error('InvalidEncryptedRecord')
            }
        }
    }
}
export type SyncCrypto = ReturnType<typeof createSyncCrypto>
