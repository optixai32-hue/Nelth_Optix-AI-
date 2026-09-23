import { NextResponse } from 'next/server'

import { vibesCleanImageBlob } from '@/lib/imagine/vibes'

export const maxDuration = 60

/**
 * Watermark removal + Nelth-IA logo. Returns the cleaned PNG bytes so
 * the browser can display them as a session blob URL (no ImageKit).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    image_url?: unknown
  } | null

  const imageUrl = typeof body?.image_url === 'string' ? body.image_url : ''
  if (!/^https?:\/\//.test(imageUrl)) {
    return NextResponse.json({ error: 'URL invalide.' }, { status: 400 })
  }

  try {
    const blob = await vibesCleanImageBlob(imageUrl)
    return new NextResponse(blob, {
      headers: { 'Content-Type': 'image/png' }
    })
  } catch (err) {
    console.error('[imagine] images/clean failed:', err)
    return NextResponse.json(
      { error: 'Le nettoyage a échoué.' },
      { status: 502 }
    )
  }
}
