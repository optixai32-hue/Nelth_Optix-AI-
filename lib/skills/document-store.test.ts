import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getDocumentCloudTarget,
  resolveStoredDocument,
  storeDocument
} from './document-store'

const ENV_KEY = 'DOCUMENT_STORE_DIR'
const savedEnv = process.env[ENV_KEY]
const savedCloudEnv: Record<string, string | undefined> = {
  IMAGEKIT_PRIVATE_KEY: process.env.IMAGEKIT_PRIVATE_KEY,
  IMAGEKIT_PUBLIC_KEY: process.env.IMAGEKIT_PUBLIC_KEY,
  IMAGEKIT_URL_ENDPOINT: process.env.IMAGEKIT_URL_ENDPOINT,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL
}

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
  for (const [k, v] of Object.entries(savedCloudEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
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

describe('getDocumentCloudTarget', () => {
  function clearCloudEnv() {
    for (const k of Object.keys(savedCloudEnv)) delete process.env[k]
  }

  it('prefers ImageKit when fully configured', () => {
    clearCloudEnv()
    process.env.IMAGEKIT_PRIVATE_KEY = 'x'
    process.env.IMAGEKIT_PUBLIC_KEY = 'x'
    process.env.IMAGEKIT_URL_ENDPOINT = 'https://x'
    process.env.R2_ACCESS_KEY_ID = 'x'
    process.env.R2_SECRET_ACCESS_KEY = 'x'
    process.env.R2_ACCOUNT_ID = 'x'
    process.env.R2_PUBLIC_URL = 'https://x'
    expect(getDocumentCloudTarget()).toEqual({ kind: 'imagekit' })
  })

  it('uses R2 only with a public base URL (signed URLs would rot)', () => {
    clearCloudEnv()
    process.env.R2_ACCESS_KEY_ID = 'x'
    process.env.R2_SECRET_ACCESS_KEY = 'x'
    process.env.R2_ACCOUNT_ID = 'x'
    expect(getDocumentCloudTarget()).toEqual({ kind: 'none' })
    process.env.R2_PUBLIC_URL = 'https://cdn.example.com'
    expect(getDocumentCloudTarget()).toEqual({ kind: 'r2' })
  })

  it('returns none without cloud credentials (disk-only store)', () => {
    clearCloudEnv()
    expect(getDocumentCloudTarget()).toEqual({ kind: 'none' })
  })
})
