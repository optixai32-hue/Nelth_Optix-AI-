import { NextRequest } from 'next/server'

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET } from '@/app/api/documents/[id]/route'

/**
 * REAL download-path test: the /api/documents/[id] route streams the exact bytes
 * stored by the artifact system. Proves the Download button points at a real file.
 */

let storeDir: string
let storeDocument: typeof import('@/lib/skills/document-store').storeDocument

beforeAll(async () => {
  storeDir = mkdtempSync(path.join(tmpdir(), 'docdl-'))
  process.env.DOCUMENT_STORE_DIR = storeDir
  const mod = await import('@/lib/skills/document-store')
  storeDocument = mod.storeDocument
})

afterAll(() => {
  rmSync(storeDir, { recursive: true, force: true })
})

describe('TEST 8/10 — document download route returns the real file', () => {
  it('serves a stored DOCX with correct content-type and bytes', async () => {
    const bytes = Buffer.from('PK real docx payload for download test')
    const stored = await storeDocument(
      bytes,
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )

    const res = await GET(
      new NextRequest(`http://localhost/api/documents/${stored.id}`),
      {
        params: Promise.resolve({ id: stored.id })
      } as never
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(res.headers.get('Content-Disposition')).toContain('report.docx')

    const out = Buffer.from(await res.arrayBuffer())
    expect(out.equals(bytes)).toBe(true)
  })

  it('returns 404 for an unknown id (no fake artifact)', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/documents/doesnotexist'),
      {
        params: Promise.resolve({ id: 'doesnotexist' })
      } as never
    )
    expect(res.status).toBe(404)
  })
})
