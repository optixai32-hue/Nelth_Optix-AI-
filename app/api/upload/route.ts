import { NextRequest, NextResponse } from 'next/server'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import ImageKit from 'imagekit'

import { capture } from '@/lib/analytics/dispatch'
import { getCurrentUserId } from '@/lib/auth/get-current-user'
import { ALLOWED_UPLOAD_MIME_TYPES } from '@/lib/constants'
import * as dbActions from '@/lib/db/actions'
import {
  getLocalFileUrl,
  saveLocalFile
} from '@/lib/storage/local-file-store'
import {
  getR2Client,
  getSignedFileUrl,
  isObjectStorageConfigured,
  R2_BUCKET_NAME
} from '@/lib/storage/r2-client'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES: string[] = [...ALLOWED_UPLOAD_MIME_TYPES]

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isObjectStorageConfigured()) {
      console.warn(
        '[upload] Object storage (R2/S3) is not configured — falling back to local filesystem storage.'
      )
    }

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 400 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    const chatId = formData.get('chatId') as string
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large (max 20MB)' },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type' },
        { status: 400 }
      )
    }
    // Absolute base URL so the returned upload URL is usable by server-side
    // tool calls (document/fetch) and browser previews alike. Prefer Next.js's
    // parsed origin; fall back to the forwarded host headers.
    const origin =
      req.nextUrl.origin ||
      `${req.headers.get('x-forwarded-proto') || 'http'}://${
        req.headers.get('host') || 'localhost:3000'
      }`
    const result = await uploadFileToR2(file, userId, chatId, origin)
    if (process.env.ENABLE_AUTH === 'false') {
      return NextResponse.json({ success: true, file: result }, { status: 200 })
    }

    let libraryFile = null
    try {
      const createdFile = await dbActions.createLibraryFile({
        userId,
        chatId: chatId || null,
        filename: result.filename,
        objectKey: result.key,
        mediaType: result.mediaType,
        size: file.size
      })
      libraryFile = {
        ...createdFile,
        key: createdFile.objectKey,
        url: result.url
      }
      await capture({
        event: 'file_saved_to_library',
        distinctId: userId,
        properties: {
          mediaType: result.mediaType,
          source: 'upload',
          size: file.size
        }
      })
    } catch (error) {
      console.error('Library file metadata save failed:', error)
    }

    return NextResponse.json(
      {
        success: true,
        file: libraryFile
          ? { ...result, id: libraryFile.id, size: file.size, libraryFile }
          : { ...result, size: file.size }
      },
      { status: 200 }
    )
  } catch (err: any) {
    console.error('Upload Error:', err)
    return NextResponse.json(
      { error: 'Upload failed', message: err.message },
      { status: 500 }
    )
  }
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-z0-9.\-_]/gi, '_').toLowerCase()
}

async function uploadFileToR2(
  file: File,
  userId: string,
  chatId: string,
  origin?: string
) {
  const sanitizedFileName = sanitizeFilename(file.name)
  const filePath = `${userId}/chats/${chatId}/${Date.now()}-${sanitizedFileName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  if (
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  ) {
    try {
      const imageKit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
      })
      const result = await imageKit.upload({
        file: buffer,
        fileName: sanitizedFileName,
        folder: `/nelth-ai/${userId}/chats/${chatId || 'draft'}`,
        useUniqueFileName: true
      })
      return {
        filename: file.name,
        key: `imagekit:${result.filePath}`,
        url: result.url,
        mediaType: file.type,
        type: 'file'
      }
    } catch (error: any) {
      console.warn('[upload] ImageKit upload failed; trying object storage:', error)
    }
  }

  // Object storage path (production).
  if (isObjectStorageConfigured()) {
    try {
      const r2Client = getR2Client()
      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: filePath,
          Body: buffer,
          ContentType: file.type,
          CacheControl: 'max-age=3600'
        })
      )
      const signedUrl = await getSignedFileUrl(filePath)
      return {
        filename: file.name,
        key: filePath,
        url: signedUrl,
        mediaType: file.type,
        type: 'file'
      }
    } catch (error: any) {
      throw new Error('Upload failed: ' + error.message)
    }
  }

  // Local filesystem fallback (dev / anonymous mode without object storage).
  try {
    saveLocalFile(filePath, buffer, file.type)
    const localUrl = origin
      ? `${origin}/api/local-file?key=${encodeURIComponent(filePath)}`
      : getLocalFileUrl(filePath)
    return {
      filename: file.name,
      key: filePath,
      url: localUrl,
      mediaType: file.type,
      type: 'file'
    }
  } catch (error: any) {
    throw new Error('Local upload failed: ' + error.message)
  }
}
