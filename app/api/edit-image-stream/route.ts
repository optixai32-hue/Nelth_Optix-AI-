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
      upstream = await fetch(`${BASE_URL}/api/edit-image-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: 'edit-image-stream failed', details: errText },
        { status: upstream.status }
      )
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    })
  } catch (err: any) {
    console.error('[edit-image-stream] proxy failed:', err)
    return NextResponse.json(
      { error: 'edit-image-stream proxy failed', message: err?.message },
      { status: 502 }
    )
  }
}
