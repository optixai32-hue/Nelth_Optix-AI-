import { Communicate } from 'edge-tts-universal'

export const runtime = 'nodejs'

const MAX_TEXT_CHARS = 2000

const VOICE_BY_LOCALE: Record<string, string> = {
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-AvaMultilingualNeural'
}

/**
 * Text-to-speech over Microsoft Edge neural voices (same engine as the
 * standalone Nelth-Voice backend, served here so voice mode works on the
 * hosted app with zero extra infrastructure).
 *
 * POST { text, locale?, voice?, rate?, pitch? } → audio/mpeg bytes.
 */
export async function POST(req: Request) {
  let body: {
    text?: unknown
    locale?: unknown
    voice?: unknown
    rate?: unknown
    pitch?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return Response.json({ error: 'Missing text' }, { status: 400 })
  }

  const locale =
    typeof body.locale === 'string' &&
    body.locale.toLowerCase().startsWith('en')
      ? 'en'
      : 'fr'
  const voice =
    typeof body.voice === 'string' && body.voice
      ? body.voice
      : (VOICE_BY_LOCALE[locale] ?? VOICE_BY_LOCALE.fr)
  const rate = typeof body.rate === 'string' ? body.rate : undefined
  const pitch = typeof body.pitch === 'string' ? body.pitch : undefined

  const speak = text.slice(0, MAX_TEXT_CHARS)

  try {
    const communicate = new Communicate(speak, {
      voice,
      ...(rate ? { rate } : {}),
      ...(pitch ? { pitch } : {})
    })
    const chunks: Buffer[] = []
    for await (const chunk of communicate.stream()) {
      const data = (chunk as { type?: string; data?: unknown }).data
      if ((chunk as { type?: string }).type === 'audio' && data) {
        chunks.push(Buffer.from(data as Uint8Array))
      }
    }
    if (chunks.length === 0) {
      return Response.json({ error: 'No audio generated' }, { status: 502 })
    }
    return new Response(Buffer.concat(chunks), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store'
      }
    })
  } catch (error) {
    console.error('[Voice] TTS failed:', error)
    return Response.json({ error: 'Speech synthesis failed' }, { status: 502 })
  }
}
