import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM envelope for OAuth tokens at rest.
 *
 * The key comes from CONNECTORS_ENCRYPTION_KEY (32 bytes, hex-encoded).
 * Every value is fail-closed: missing/invalid key or tampered payload throws,
 * never returns plaintext. Format: `v1.<iv-hex>.<ciphertext-hex>.<tag-hex>`.
 */

function resolveKey(): Buffer {
  const raw = (process.env.CONNECTORS_ENCRYPTION_KEY ?? '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'CONNECTORS_ENCRYPTION_KEY must be set to 32 random bytes, hex-encoded (64 hex chars). Generate with: openssl rand -hex 32'
    )
  }
  return Buffer.from(raw, 'hex')
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret requires a non-empty string')
  }
  const key = resolveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('hex')}.${ciphertext.toString('hex')}.${tag.toString('hex')}`
}

export function decryptSecret(payload: string): string {
  const parts = typeof payload === 'string' ? payload.split('.') : []
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted payload format')
  }
  const key = resolveKey()
  const [, ivHex, dataHex, tagHex] = parts
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex')
    )
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return (
      decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') +
      decipher.final('utf8')
    )
  } catch {
    throw new Error(
      'Failed to decrypt payload (wrong key or tampered data)'
    )
  }
}
