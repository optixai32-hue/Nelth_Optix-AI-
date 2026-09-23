import { NextResponse } from 'next/server'

import { vibesCleanImageUrl, vibesGenerateImages } from '@/lib/imagine/vibes'

export const maxDuration = 60

const RATIOS = ['1:1', '16:9', '9:16'] as const

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown
    aspectRatio?: unknown
    variations?: unknown
  } | null

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const aspectRatio = RATIOS.includes(
    body?.aspectRatio as (typeof RATIOS)[number]
  )
    ? (body?.aspectRatio as (typeof RATIOS)[number])
    : '1:1'
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
    const data = await vibesGenerateImages({ prompt, aspectRatio, variations })
    // The backend returns raw fbcdn URLs — watermark-clean each (hosted
    // on ImageKit, exposed via the X-Imagekit-Url header). Fallback keeps
    // the raw URL so the image stays visible.
    const cleaned = await Promise.all(
      data.map(async d => {
        const c = await vibesCleanImageUrl(d.url)
        return { ...d, url: c.url, cleaned: c.cleaned }
      })
    )
    return NextResponse.json({ success: true, data: cleaned })
  } catch (err) {
    console.error('[imagine] images/generate failed:', err)
    return NextResponse.json(
      { error: 'La génération a échoué, réessaie.' },
      { status: 502 }
    )
  }
}
