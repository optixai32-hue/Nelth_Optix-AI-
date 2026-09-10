import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'whisper-large-v3-turbo'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let audioBlob: Blob | null = null
    let filename = 'audio.m4a'

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = (formData.get('file') ||
        formData.get('audio')) as Blob | null
      if (file) {
        audioBlob = file
        if ('name' in file && typeof file.name === 'string') {
          filename = file.name
        }
      }
    } else if (contentType.includes('application/json')) {
      const body = await req.json()
      if (body.audioBase64) {
        const raw = body.audioBase64.includes(',')
          ? body.audioBase64.split(',')[1]
          : body.audioBase64
        const buffer = Buffer.from(raw, 'base64')
        const mimeType = body.mimeType || 'audio/m4a'
        audioBlob = new Blob([buffer], { type: mimeType })
        filename = mimeType.includes('webm')
          ? 'audio.webm'
          : mimeType.includes('wav')
            ? 'audio.wav'
            : 'audio.m4a'
      }
    } else {
      // Raw audio body
      const buffer = Buffer.from(await req.arrayBuffer())
      if (buffer.length > 0) {
        audioBlob = new Blob([buffer], { type: contentType || 'audio/webm' })
      }
    }

    if (!audioBlob || audioBlob.size === 0) {
      return NextResponse.json(
        { error: 'Aucun fichier audio fourni' },
        { status: 400 }
      )
    }

    // Call Groq Whisper Large v3 Turbo
    const upstreamFormData = new FormData()
    upstreamFormData.append('file', audioBlob, filename)
    upstreamFormData.append('model', GROQ_MODEL)
    upstreamFormData.append('temperature', '0')
    upstreamFormData.append('response_format', 'verbose_json')

    const groqRes = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: upstreamFormData
    })

    if (!groqRes.ok) {
      const errorText = await groqRes.text().catch(() => '')
      console.error('[Groq STT] Error response:', groqRes.status, errorText)
      return NextResponse.json(
        { error: `Groq STT error: ${groqRes.statusText}`, details: errorText },
        { status: groqRes.status }
      )
    }

    const data = await groqRes.json()
    const text = typeof data.text === 'string' ? data.text.trim() : ''

    return NextResponse.json({
      success: true,
      text,
      language: data.language,
      duration: data.duration
    })
  } catch (err: any) {
    console.error('[Groq STT] Transcription failed:', err)
    return NextResponse.json(
      { error: err?.message || 'Erreur lors de la transcription audio' },
      { status: 500 }
    )
  }
}
