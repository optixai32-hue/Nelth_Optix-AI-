import { anthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createProviderRegistry, LanguageModel } from 'ai'
import { createOllama } from 'ai-sdk-ollama'

// Strip a trailing /v1 from the configured base URL, then re-append it,
// so both shapes work for OpenAI-compatible hosts:
//   OPENAI_COMPATIBLE_API_BASE_URL=https://api.deepseek.com
//   OPENAI_COMPATIBLE_API_BASE_URL=https://api.deepseek.com/v1
function normalizeOpenAICompatibleBaseURL(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'
}

// Nelth-3.5 (tencent/hy3:free) and Nelth-3.5 Thinking
// (stepfun/step-3.7-flash:free) are both served from the Kilo AI gateway
// (https://api.kilo.ai/api/gateway/chat/completions). Nelth-3.5 must run with
// thinking OFF — we send `chat_template_kwargs.reasoning_effort: "no_think"`
// inside `extra_body`, matching the gateway's expected request shape.
// Nelth-3.5 Thinking stays on the gateway with thinking ON (untouched).
//
// NOTE: we never send a reasoning budget — with thinking disabled a reasoning
// budget is contradictory. Skills are applied via the prompt layer
// (researcher.ts), which instructs the model to output the COMPLETE artifact
// directly (no separate "design brief").
const NELTH_NON_THINKING_MODEL = 'tencent/hy3:free'

const NELTH_NON_THINKING_BODY = {
  temperature: 0.9,
  top_p: 1.0
}

// The Kilo gateway endpoint (both Nelth-3.5 and Nelth-3.5 Thinking) shares a
// worker with a hard concurrency cap. When it is exceeded the endpoint returns
// HTTP 503 with `ResourceExhausted: Worker local total request limit reached
// (16/16)` (or a hang). This is transient — the slot frees up shortly after —
// so retry with exponential backoff instead of surfacing "We could not generate
// a response". Scoped to retryable status codes only; successful responses are
// returned untouched, so Nelth-3.5 Thinking's behavior is unchanged.
const NELTH_MAX_RETRIES = 5
const NELTH_RETRY_BASE_MS = 800

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504)
}

// NVIDIA's streaming endpoint reports capacity/overload failures as HTTP 200
// with an SSE body like:
//   data: {"error":{"message":"ResourceExhausted: ...","type":"internal_server_error","code":500}}
//   data: [DONE]
// so a status-code check never sees them. Detect the error in the FIRST SSE
// event and retry; replay everything else verbatim so streaming is untouched.
function parseSseDataLine(line: string): Record<string, any> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const json = trimmed.slice(5).trim()
  if (!json || json === '[DONE]') return null
  try {
    return JSON.parse(json) as Record<string, any>
  } catch {
    return null
  }
}

function isRetryableErrorPayload(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, any>
  const text = `${e?.message ?? ''} ${e?.type ?? ''} ${e?.code ?? ''}`
  return /resourceexhausted|rate.?limit|too many requests|overloaded|service unavailable|capacity|try again later|internal_server_error|server_error/i.test(
    text
  )
}

// Fetch once. Returns retry=true when the response is a transient failure we
// should retry (status code OR streamed SSE error). When retry=false, `res` is a
// Response whose body replays the original stream exactly (so successful streams
// are forwarded unchanged, byte-for-byte).
async function nelthTryFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ retry: boolean; res: Response | null }> {
  const res = await fetch(input, init)
  if (isRetryableStatus(res.status)) {
    try {
      await res.arrayBuffer()
    } catch {
      /* ignore */
    }
    return { retry: true, res: null }
  }
  if (!res.body) return { retry: false, res }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const buffered: Uint8Array[] = []
  let text = ''
  let decision: 'error' | 'ok' | 'none' = 'none'

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) buffered.push(value)
      text += decoder.decode(value, { stream: true })

      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = parseSseDataLine(line)
        if (!payload) continue
        if (payload.error) {
          decision = isRetryableErrorPayload(payload.error) ? 'error' : 'ok'
        } else {
          decision = 'ok'
        }
        break
      }
      if (decision !== 'none') break
    }
  } catch {
    return { retry: false, res }
  }

  if (decision === 'error') {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
    return { retry: true, res: null }
  }

  const replay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (const chunk of buffered) controller.enqueue(chunk)
        buffered.length = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            break
          }
          if (value) controller.enqueue(value)
        }
      } catch (err) {
        controller.error(err)
      }
    }
  })

  return {
    retry: false,
    res: new Response(replay, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    })
  }
}

const nelthFetch: typeof fetch = async (input, init) => {
  if (init && typeof init.body === 'string') {
    try {
      const parsed = JSON.parse(init.body) as Record<string, any>
      if (
        typeof parsed?.model === 'string' &&
        (parsed.model === NELTH_NON_THINKING_MODEL ||
          parsed.model.endsWith('/hy3:free'))
      ) {
        parsed.extra_body = {
          ...(parsed.extra_body || {}),
          chat_template_kwargs: {
            ...(parsed.extra_body?.chat_template_kwargs || {}),
            enable_thinking: false,
            clear_thinking: true,
            reasoning_effort: 'no_think'
          }
        }
        for (const [key, value] of Object.entries(NELTH_NON_THINKING_BODY)) {
          parsed[key] = value
        }
        init = { ...init, body: JSON.stringify(parsed) }
      }
    } catch {
      /* non-JSON body — leave untouched */
    }
  }

  let attempt = 0
  while (true) {
    const { retry, res } = await nelthTryFetch(input, init)
    if (!retry) {
      return res ?? new Response('Upstream error', { status: 502 })
    }
    attempt++
    if (attempt >= NELTH_MAX_RETRIES) {
      // Retries exhausted — return the raw upstream response so the SDK
      // surfaces the real error instead of us hanging.
      return fetch(input, init)
    }
    const delay = NELTH_RETRY_BASE_MS * 2 ** attempt + Math.random() * 300
    console.warn(
      `[Nelth] endpoint transient error (attempt ${attempt}/${NELTH_MAX_RETRIES}); retrying in ${Math.round(delay)}ms`
    )
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}

// Build providers object conditionally
const providers: Record<string, any> = {
  openai,
  anthropic,
  google,
  'openai-compatible': createOpenAICompatible({
    // Keep the SDK provider key stable. OPENAI_COMPATIBLE_PROVIDER_NAME is
    // only a UI label used by the model selector.
    name: 'openai-compatible',
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
    baseURL: normalizeOpenAICompatibleBaseURL(
      process.env.OPENAI_COMPATIBLE_API_BASE_URL || ''
    ),
    fetch: nelthFetch
  }),
  'kilo-gateway': createOpenAICompatible({
    name: 'kilo-gateway',
    apiKey: process.env.KILO_API_KEY,
    baseURL:
      process.env.KILO_GATEWAY_BASE_URL || 'https://api.kilo.ai/api/gateway',
    fetch: nelthFetch
  }),
  gateway: createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY
  })
}

// Only add Ollama if OLLAMA_BASE_URL is configured
const ollamaProvider = process.env.OLLAMA_BASE_URL
  ? createOllama({ baseURL: process.env.OLLAMA_BASE_URL })
  : null

if (ollamaProvider) {
  providers.ollama = ollamaProvider
}

export const registry = createProviderRegistry(providers)

export function getModel(model: string): LanguageModel {
  // For Ollama models, bypass the registry to pass model-level settings
  // that ai-sdk-ollama requires (think, supportedUrls override).
  if (model.startsWith('ollama:') && ollamaProvider) {
    const modelId = model.slice('ollama:'.length)
    const lm = ollamaProvider(modelId, { think: true })

    // Ollama's Chat API only accepts base64 in the images field, not URLs.
    // Override supportedUrls to force AI SDK to download images and convert
    // them to base64 before sending to the model.
    Object.defineProperty(lm, 'supportedUrls', {
      value: {},
      configurable: true
    })

    return lm
  }

  return registry.languageModel(
    model as Parameters<typeof registry.languageModel>[0]
  )
}

export function isProviderEnabled(providerId: string): boolean {
  switch (providerId) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY
    case 'google':
      return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
    case 'openai-compatible':
      return (
        !!process.env.OPENAI_COMPATIBLE_API_KEY &&
        !!process.env.OPENAI_COMPATIBLE_API_BASE_URL
      )
    case 'kilo-gateway':
      return !!process.env.KILO_API_KEY
    case 'gateway':
      return !!process.env.AI_GATEWAY_API_KEY
    case 'ollama':
      return !!process.env.OLLAMA_BASE_URL
    default:
      return false
  }
}
