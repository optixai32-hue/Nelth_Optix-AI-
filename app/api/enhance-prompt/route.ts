import { NextRequest, NextResponse } from 'next/server'

const BASE_URL =
  process.env.IMAGE_EDIT_API_BASE_URL || 'https://nelth-v2.space-z.ai'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    let upstream: Response
    try {
      upstream = await fetch(`${BASE_URL}/api/enhance-prompt`, {
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
    console.error('[enhance-prompt] proxy failed:', err)
    return NextResponse.json(
      { error: 'enhance-prompt proxy failed', message: err?.message },
      { status: 502 }
    )
  }
}
