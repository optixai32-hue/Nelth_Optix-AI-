import { NextResponse } from 'next/server'

import { vibesEditImage } from '@/lib/imagine/vibes'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sourceImageEntId?: unknown
    editPrompt?: unknown
  } | null

  const sourceImageEntId =
    typeof body?.sourceImageEntId === 'string' ? body.sourceImageEntId : ''
  const editPrompt =
    typeof body?.editPrompt === 'string' ? body.editPrompt.trim() : ''

  if (!sourceImageEntId) {
    return NextResponse.json({ error: 'Image source requise.' }, { status: 400 })
  }
  if (!editPrompt) {
    return NextResponse.json(
      { error: 'Décris la modification.' },
      { status: 400 }
    )
  }
  if (editPrompt.length > 2000) {
    return NextResponse.json({ error: 'Prompt trop long.' }, { status: 400 })
  }

  try {
    const result = await vibesEditImage({ sourceImageEntId, editPrompt })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[imagine] images/edit failed:', err)
    return NextResponse.json(
      { error: "L'édition a échoué, réessaie." },
      { status: 502 }
    )
  }
}
