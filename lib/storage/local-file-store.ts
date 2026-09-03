import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Local filesystem fallback for uploaded files, used when object storage
 * (R2/S3) is not configured (e.g. local dev / anonymous mode). This lets file
 * uploads succeed out of the box instead of failing with
 * "File upload storage is not configured".
 *
 * Files are written under `.local-uploads/` (gitignored) keyed by the same
 * `${userId}/chats/${chatId}/${name}` path used for object storage, and served
 * back through `/api/local-file`.
 */

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), '.local-uploads')

function candidateDirs(): string[] {
  return [
    LOCAL_UPLOAD_DIR,
    // Serverless (Vercel, …): the project directory is READ-ONLY, only the
    // OS temp directory is writable. Without this fallback every local file
    // write (e.g. generated-image persistence) fails with EROFS.
    path.join(os.tmpdir(), '.local-uploads')
  ]
}

function canWriteDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function getBaseDir(): string {
  for (const dir of candidateDirs()) {
    if (canWriteDir(dir)) return dir
  }
  throw new Error('No writable local file directory')
}

const LOCAL_FILE_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? ''

export function getLocalFileUrl(key: string): string {
  const pathPart = `/api/local-file?key=${encodeURIComponent(key)}`
  return LOCAL_FILE_BASE_URL ? `${LOCAL_FILE_BASE_URL}${pathPart}` : pathPart
}

/**
 * Resolve a key to an absolute path strictly inside LOCAL_UPLOAD_DIR.
 * Returns null when the key is empty, contains a NUL byte, or escapes the base
 * directory (path traversal protection).
 */
function safeResolve(key: string): string | null {
  const normalized = key.replace(/^\/+/, '').trim()
  if (!normalized || normalized.includes('\0')) return null
  const base = path.resolve(getBaseDir())
  const resolved = path.resolve(base, normalized)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
  return resolved
}

export function saveLocalFile(
  key: string,
  buffer: Buffer,
  contentType: string
): void {
  const resolved = safeResolve(key)
  if (!resolved) throw new Error('Invalid local file key')
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, buffer)
  // Persist the content type alongside the bytes so the GET route can serve it.
  fs.writeFileSync(`${resolved}.ct`, contentType)
}

export function readLocalFile(
  key: string
): { buffer: Buffer; contentType: string } | null {
  const resolved = safeResolve(key)
  if (!resolved) return null
  try {
    const buffer = fs.readFileSync(resolved)
    let contentType = 'application/octet-stream'
    try {
      contentType = fs.readFileSync(`${resolved}.ct`, 'utf8')
    } catch {
      // Fall back to octet-stream if the content-type sidecar is missing.
    }
    return { buffer, contentType }
  } catch {
    return null
  }
}
