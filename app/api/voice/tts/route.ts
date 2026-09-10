import { NextRequest } from 'next/server'
import { Communicate } from 'edge-tts-universal'

export const dynamic = 'force-dynamic'

const DEFAULT_VOICE = 'en-US-AvaMultilingualNeural'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, voice = DEFAULT_VOICE, rate, pitch } = body

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Texte manquant ou invalide' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const options: any = { voice }
    if (rate) options.rate = rate
    if (pitch) options.pitch = pitch

    const communicate = new Communicate(text, options)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of communicate.stream()) {
            if (chunk.type === 'audio' && chunk.data) {
              controller.enqueue(Buffer.from(chunk.data))
            }
          }
          controller.close()
        } catch (streamErr) {
          controller.error(streamErr)
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform'
      }
    })
  } catch (err: any) {
    console.error('[Voice TTS] Error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Erreur Edge-TTS' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
