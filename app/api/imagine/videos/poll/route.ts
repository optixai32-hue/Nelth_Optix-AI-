import { NextResponse } from 'next/server'

import { vibesPollBatch } from '@/lib/imagine/vibes'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    batchId?: unknown
  } | null

  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  if (!batchId) {
    return NextResponse.json({ error: 'batchId requis.' }, { status: 400 })
  }

  try {
    const batch = await vibesPollBatch(batchId)
    return NextResponse.json({ success: true, batch })
  } catch (err) {
    console.error('[imagine] videos/poll failed:', err)
    return NextResponse.json(
      { error: 'Le suivi a échoué, réessaie.' },
      { status: 502 }
    )
  }
}
