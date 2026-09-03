import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveStoredDocument, storeDocument } from './document-store'

const ENV_KEY = 'DOCUMENT_STORE_DIR'
const savedEnv = process.env[ENV_KEY]

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
})

describe('document-store', () => {
  it('round-trips a stored document', async () => {
    const stored = await storeDocument(
      Buffer.from('%PDF-1.4 test'),
      'facture.pdf',
      'application/pdf'
    )
    expect(stored.id).toMatch(/^[a-z0-9]+$/i)
    const found = await resolveStoredDocument(stored.id)
    expect(found).not.toBeNull()
    expect(found!.buffer.toString()).toBe('%PDF-1.4 test')
    expect(found!.meta.fileName).toBe('facture.pdf')
  })

  it('falls back to a writable dir when DOCUMENT_STORE_DIR is unusable', async () => {
    // Point at an existing FILE: mkdir inside it always fails (ENOTDIR),
    // simulating a read-only project dir (Vercel serverless EROFS).
    process.env[ENV_KEY] = path.join(process.cwd(), 'package.json', 'sub')
    const stored = await storeDocument(
      Buffer.from('fallback-ok'),
      'note.pdf',
      'application/pdf'
    )
    const found = await resolveStoredDocument(stored.id)
    expect(found?.buffer.toString()).toBe('fallback-ok')
  })

  it('returns null for unknown ids', async () => {
    expect(await resolveStoredDocument('nope-not-here-123')).toBeNull()
    expect(await resolveStoredDocument('../evil')).toBeNull()
  })
})
