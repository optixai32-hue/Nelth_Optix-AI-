import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { VOICE_ONLY_SYSTEM_PROMPT } from '@/lib/voice/voice-prompt'

export const dynamic = 'force-dynamic'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const TARGET_VOICE_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
// Fallback if target reasoning model is temporarily busy/exhausted
const FALLBACK_VOICE_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'

export async function POST(req: NextRequest) {
  try {
    const { text, history = [] } = await req.json()

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Texte manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const apiKey = process.env.NVIDIA_API_KEY?.trim()
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'NVIDIA_API_KEY non configurée' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const client = new OpenAI({
      baseURL: NVIDIA_BASE_URL,
      apiKey
    })

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: VOICE_ONLY_SYSTEM_PROMPT
      }
    ]

    // Append last 4-6 conversational turns for context without bloat
    if (Array.isArray(history)) {
      for (const item of history.slice(-6)) {
        if (!item || typeof item.text !== 'string') continue
        const clean = item.text
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<\/?[a-zA-Z0-9_-]+>/g, '')
          .trim()
        if (clean) {
          messages.push({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: clean
          })
        }
      }
    }

    messages.push({
      role: 'user',
      content: text.trim()
    })

    let completion: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      completion = (await client.chat.completions.create({
        model: TARGET_VOICE_MODEL,
        messages,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 350,
        stream: true
      })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    } catch (modelErr: any) {
      console.warn(
        `[Voice LLM] Target model error (${TARGET_VOICE_MODEL}): ${modelErr?.message}. Trying fallback ${FALLBACK_VOICE_MODEL}...`
      )
      completion = (await client.chat.completions.create({
        model: FALLBACK_VOICE_MODEL,
        messages,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 350,
        stream: true
      })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let inThinkTag = false
        let thinkBuffer = ''

        try {
          for await (const chunk of completion) {
            const content = chunk.choices?.[0]?.delta?.content
            if (!content) continue

            // Filter out <think>...</think> reasoning tokens from voice output
            if (inThinkTag) {
              thinkBuffer += content
              if (thinkBuffer.includes('</think>')) {
                const parts = thinkBuffer.split('</think>')
                inThinkTag = false
                const remaining = parts.slice(1).join('</think>')
                thinkBuffer = ''
                if (remaining.trim()) {
                  controller.enqueue(encoder.encode(remaining))
                }
              }
              continue
            }

            if (content.includes('<think>')) {
              inThinkTag = true
              const parts = content.split('<think>')
              if (parts[0].trim()) {
                controller.enqueue(encoder.encode(parts[0]))
              }
              thinkBuffer = parts.slice(1).join('<think>')
              continue
            }

            // Normal spoken text token
            controller.enqueue(encoder.encode(content))
          }
          controller.close()
        } catch (streamErr) {
          controller.error(streamErr)
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform'
      }
    })
  } catch (err: any) {
    console.error('[Voice Chat] Error:', err)
    return new Response(JSON.stringify({ error: err?.message || 'Erreur Voice LLM' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
