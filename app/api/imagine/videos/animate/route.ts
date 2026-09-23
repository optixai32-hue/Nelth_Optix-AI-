import { NextResponse } from 'next/server'

import { vibesAnimateVideo } from '@/lib/imagine/vibes'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    source?: unknown
    motion?: unknown
  } | null

  const source = body?.source as
    | { id?: unknown; imageUrl?: unknown; mediaEntId?: unknown }
    | undefined
  const motion =
    typeof body?.motion === 'string' && body.motion.trim().length > 0
      ? body.motion.trim().slice(0, 2000)
      : undefined

  if (
    !source ||
    typeof source.id !== 'string' ||
    typeof source.imageUrl !== 'string' ||
    typeof source.mediaEntId !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Image source requise.' },
      { status: 400 }
    )
  }

  try {
    const { batchId } = await vibesAnimateVideo({
      source: {
        id: source.id,
        imageUrl: source.imageUrl,
        mediaEntId: source.mediaEntId,
        prompt: motion ?? 'Uploaded image'
      },
      motion
    })
    return NextResponse.json({ success: true, batchId })
  } catch (err) {
    console.error('[imagine] videos/animate failed:', err)
    return NextResponse.json(
      { error: "L'animation a échoué, réessaie." },
      { status: 502 }
    )
  }
}
