/**
 * Minimal document store for generated artifacts.
 *
 * Generates a stable random id, persists the buffer on disk (under a directory
 * that must be git-ignored) and serves it back by id. This is intentionally
 * simple — the app is single-user / anonymous by default — and gives the chatbot
 * a real, downloadable file URL for the documents it produces.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'
import ImageKit from 'imagekit'
import os from 'os'
import path from 'path'

import {
  getR2Client,
  isObjectStorageConfigured,
  R2_BUCKET_NAME
} from '@/lib/storage/r2-client'

const STORE_SUBDIR = '.document-store'

function candidateDirs(): string[] {
  const dirs: string[] = []
  const fromEnv = process.env.DOCUMENT_STORE_DIR?.trim()
  if (fromEnv) dirs.push(fromEnv)
  dirs.push(path.join(import.meta.dirname ?? process.cwd(), STORE_SUBDIR))
  // Serverless (Vercel, …): the project directory is READ-ONLY, only the OS
  // temp directory is writable. Without this fallback every generated
  // document fails with EROFS.
  dirs.push(path.join(os.tmpdir(), STORE_SUBDIR))
  return dirs
}

async function canWriteDir(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.access(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function ensureDir(): Promise<string> {
  for (const dir of candidateDirs()) {
    if (await canWriteDir(dir)) return dir
  }
  throw new Error(
    'No writable document store directory (tried DOCUMENT_STORE_DIR, project dir and os.tmpdir())'
  )
}

function randomId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  ).replace(/[^a-z0-9]/gi, '')
}

export interface StoredDocument {
  id: string
  fileName: string
  mimeType: string
  size: number
  /**
   * Permanent public URL when the file also reached cloud storage
   * (ImageKit, or R2 with a public base URL). Null on disk-only stores —
   * those only survive on the instance that created them.
   */
  publicUrl: string | null
}

/**
 * Which durable cloud target (if any) the current environment offers.
 * Pure env read so it is unit-testable without network access.
 * R2 counts ONLY with R2_PUBLIC_URL: without a public bucket the SDK can
 * only mint expiring signed URLs, which would rot inside chat history.
 */
export function getDocumentCloudTarget():
  | { kind: 'imagekit' }
  | { kind: 'r2' }
  | { kind: 'none' } {
  if (
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  ) {
    return { kind: 'imagekit' }
  }
  if (isObjectStorageConfigured() && process.env.R2_PUBLIC_URL) {
    return { kind: 'r2' }
  }
  return { kind: 'none' }
}

let imageKitClient: ImageKit | null = null
function getImageKitClient(): ImageKit | null {
  if (
    !process.env.IMAGEKIT_PRIVATE_KEY ||
    !process.env.IMAGEKIT_PUBLIC_KEY ||
    !process.env.IMAGEKIT_URL_ENDPOINT
  ) {
    return null
  }
  if (!imageKitClient) {
    imageKitClient = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY as string,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY as string,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT as string
    })
  }
  return imageKitClient
}

/**
 * Upload to durable cloud storage. NEVER throws: a cloud hiccup must not
 * fail the generation — the disk copy below always exists as fallback.
 */
async function uploadToCloud(
  buffer: Buffer,
  fileName: string
): Promise<string | null> {
  const target = getDocumentCloudTarget()
  try {
    if (target.kind === 'imagekit') {
      const client = getImageKitClient()
      if (!client) return null
      const result = await client.upload({
        file: buffer.toString('base64'),
        fileName,
        folder: '/generated-documents',
        useUniqueFileName: true
      })
      return typeof result?.url === 'string' ? result.url : null
    }
    if (target.kind === 'r2') {
      const publicBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '')
      const key = `generated-documents/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}-${fileName}`
      await getR2Client().send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: 'application/octet-stream'
        })
      )
      return `${publicBase}/${key}`
    }
  } catch (e) {
    console.warn('Document cloud upload failed; using local store:', e)
  }
  return null
}

export async function storeDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<StoredDocument> {
  const dir = await ensureDir()
  const id = randomId()
  const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_')
  const filePath = path.join(dir, `${id}__${safeName}`)
  await fs.writeFile(filePath, buffer)
  // Durable copy for serverless (disk is per-instance/ephemeral there):
  // when it succeeds, downloads use this permanent URL instead of the
  // instance-local /api/documents route.
  const publicUrl = await uploadToCloud(buffer, safeName)
  return { id, fileName: safeName, mimeType, size: buffer.length, publicUrl }
}

export async function resolveStoredDocument(
  id: string
): Promise<{ buffer: Buffer; meta: StoredDocument } | null> {
  if (!/^[a-z0-9]+$/i.test(id)) return null
  const dir = await ensureDir()
  const entries = await fs.readdir(dir)
  const match = entries.find(e => e.startsWith(`${id}__`))
  if (!match) return null
  const buffer = await fs.readFile(path.join(dir, match))
  const meta = match.split('__') as [string, string]
  const mimeType = mimeByExtension(meta[1])
  return {
    buffer,
    meta: { id, fileName: meta[1], mimeType, size: buffer.length, publicUrl: null }
  }
}

function mimeByExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  return 'application/octet-stream'
}
