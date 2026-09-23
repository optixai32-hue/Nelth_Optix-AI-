import { NextResponse } from 'next/server'

import { vibesGenerateVideo } from '@/lib/imagine/vibes'

export const maxDuration = 60

const RATIOS = ['1:1', '16:9', '9:16'] as const
const RESOLUTIONS = ['480p', '720p'] as const

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown
    aspectRatio?: unknown
    resolution?: unknown
    variations?: unknown
  } | null

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const aspectRatio = RATIOS.includes(body?.aspectRatio as (typeof RATIOS)[number])
    ? (body?.aspectRatio as (typeof RATIOS)[number])
    : '1:1'
  const resolution = RESOLUTIONS.includes(
    body?.resolution as (typeof RESOLUTIONS)[number]
  )
    ? (body?.resolution as (typeof RESOLUTIONS)[number])
    : '480p'
  const variations =
    typeof body?.variations === 'number' &&
    Number.isInteger(body.variations) &&
    body.variations >= 1 &&
    body.variations <= 4
      ? body.variations
      : 1

  if (!prompt) {
    return NextResponse.json({ error: 'Prompt requis.' }, { status: 400 })
  }
  if (prompt.length > 2000) {
    return NextResponse.json({ error: 'Prompt trop long.' }, { status: 400 })
  }

  try {
    const { batchId } = await vibesGenerateVideo({
      prompt,
      aspectRatio,
      resolution,
      variations
    })
    return NextResponse.json({ success: true, batchId })
  } catch (err) {
    console.error('[imagine] videos/generate failed:', err)
    return NextResponse.json(
      { error: 'La génération a échoué, réessaie.' },
      { status: 502 }
    )
  }
}
