import { NextRequest, NextResponse } from 'next/server'

const BASE_URL =
  process.env.IMAGE_EDIT_API_BASE_URL || 'https://nelth-v2.space-z.ai'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let upstream: Response
    try {
      upstream = await fetch(`${BASE_URL}/api/edit-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }

    const data = await upstream.json().catch(() => ({}))
    return NextResponse.json(data, { status: upstream.status })
  } catch (err: any) {
    console.error('[edit-image] proxy failed:', err)
    return NextResponse.json(
      { error: 'edit-image proxy failed', message: err?.message },
      { status: 502 }
    )
  }
}
