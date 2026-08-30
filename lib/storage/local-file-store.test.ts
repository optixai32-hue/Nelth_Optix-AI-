import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  getLocalFileUrl,
  LOCAL_UPLOAD_DIR,
  readLocalFile,
  saveLocalFile
} from './local-file-store'

const TEST_KEY = `test-user/chats/test-chat/${Date.now()}-sample.pdf`

afterAll(() => {
  try {
    fs.rmSync(path.join(LOCAL_UPLOAD_DIR, 'test-user'), {
      recursive: true,
      force: true
    })
  } catch {
    // ignore cleanup errors
  }
})

describe('local-file-store', () => {
  it('round-trips a stored file with its content type', () => {
    const buffer = Buffer.from('%PDF-1.4 sample content')
    saveLocalFile(TEST_KEY, buffer, 'application/pdf')

    const read = readLocalFile(TEST_KEY)
    expect(read).not.toBeNull()
    expect(read?.contentType).toBe('application/pdf')
    expect(read?.buffer.toString()).toBe('%PDF-1.4 sample content')
  })

  it('getLocalFileUrl encodes the key', () => {
    expect(getLocalFileUrl(TEST_KEY)).toContain('/api/local-file?key=')
    expect(getLocalFileUrl(TEST_KEY)).toContain(encodeURIComponent(TEST_KEY))
  })

  it('rejects path traversal keys', () => {
    expect(readLocalFile('../secrets.txt')).toBeNull()
    expect(readLocalFile('/etc/passwd')).toBeNull()
    expect(readLocalFile('')).toBeNull()
  })

  it('returns null for missing files', () => {
    expect(readLocalFile('test-user/chats/nonexistent/missing.pdf')).toBeNull()
  })
})
