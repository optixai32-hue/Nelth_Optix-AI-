import { NextResponse } from 'next/server'

import { vibesUploadImage } from '@/lib/imagine/vibes'

export const maxDuration = 60

// ~3MB file max (base64 +33% must stay under serverless body limits).
const MAX_BASE64_CHARS = 4_200_000

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    imageBase64?: unknown
    filename?: unknown
  } | null

  let base64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : ''
  // Accept data URLs by stripping the prefix.
  const dataUrlMatch = base64.match(/^data:image\/\w+;base64,([\s\S]*)$/)
  if (dataUrlMatch) base64 = dataUrlMatch[1]

  const filename =
    typeof body?.filename === 'string' && body.filename.length > 0
      ? body.filename.slice(0, 120)
      : 'upload.png'

  if (!base64) {
    return NextResponse.json({ error: 'Image requise.' }, { status: 400 })
  }
  if (base64.length > MAX_BASE64_CHARS) {
    return NextResponse.json(
      { error: 'Image trop lourde (max 3 Mo).' },
      { status: 400 }
    )
  }

  try {
    const result = await vibesUploadImage({ base64, filename })
    return NextResponse.json({
      success: true,
      mediaEntId: result.mediaEntId,
      sourceImageEntId: result.sourceImageEntId,
      imageUrl: result.imageUrl,
      allMediaEntIds: result.allMediaEntIds
    })
  } catch (err) {
    console.error('[imagine] upload failed:', err)
    return NextResponse.json(
      { error: "L'envoi a échoué, réessaie." },
      { status: 502 }
    )
  }
}
