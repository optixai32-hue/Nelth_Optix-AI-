import { NextResponse } from 'next/server'

import { vibesEditImage } from '@/lib/imagine/vibes'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sourceImageEntId?: unknown
    editPrompt?: unknown
    allMediaEntIds?: unknown
  } | null

  const sourceImageEntId =
    typeof body?.sourceImageEntId === 'string' ? body.sourceImageEntId : ''
  const editPrompt =
    typeof body?.editPrompt === 'string' ? body.editPrompt.trim() : ''
  const allMediaEntIds = Array.isArray(body?.allMediaEntIds)
    ? (body.allMediaEntIds as Array<{
        accountIndex: number
        mediaEntId: string
      }>)
    : undefined

  if (!sourceImageEntId) {
    return NextResponse.json(
      { error: 'Image source requise.' },
      { status: 400 }
    )
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
    const result = await vibesEditImage({
      sourceImageEntId,
      editPrompt,
      allMediaEntIds
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[imagine] images/edit failed:', err)
    const raw = err instanceof Error ? err.message : ''
    // Forward actionable backend errors instead of a generic message:
    // imagesuploaded outside this app (or before project scoping) belong
    // to another account and can never be edited — re-upload fixes it.
    const message = /different account/i.test(raw)
      ? "Cette image vient d'un autre compte : ré-upload-la puis réessaie."
      : "L'édition a échoué, réessaie."
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
