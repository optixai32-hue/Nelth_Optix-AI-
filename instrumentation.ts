import { LangfuseSpanProcessor } from '@langfuse/otel'
import { registerOTel } from '@vercel/otel'

// Exported so request handlers can force-flush pending spans before the
// serverless function exits
export const langfuseSpanProcessor = new LangfuseSpanProcessor()

export async function register() {
  registerOTel({
    serviceName: 'nelth-ia-search',
    spanProcessors: [langfuseSpanProcessor]
  })

  // Initialize Ollama validation on server startup (only when configured)
  if (process.env.OLLAMA_BASE_URL) {
    const { initializeOllamaValidation } = await import(
      '@/lib/config/ollama-validator'
    )
    await initializeOllamaValidation().catch(err => {
      console.error('Failed to initialize Ollama validation:', err)
    })
  }

  // Probe the Chromium premium PDF renderer once at startup (Node.js runtime
  // only). Caching the result means a sandbox where Chromium cannot launch is
  // detected immediately and premium documents fall back to pdf-lib without
  // waiting on the launch timeout on every request. Fire-and-forget: a failed
  // probe must never block server startup.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkChromiumPremium } = await import(
      '@/lib/skills/document-pdf-html'
    )
    checkChromiumPremium({ timeoutMs: 15000 })
      .then(ok =>
        console.log(
          ok
            ? '[document] Chromium premium renderer: READY'
            : '[document] Chromium premium renderer: UNAVAILABLE — premium documents will use the pdf-lib fallback'
        )
      )
      .catch(() => {
        /* result already cached as unavailable by checkChromiumPremium */
      })

    // OPTIMIZE-TTFT: pre-build the skill routing index + capability detector at
    // server startup so the FIRST user message does NOT pay the ~2.7s disk scan
    // of every SKILL.md frontmatter (and the one-time router JIT warmup). With
    // the index cached, skill routing + SKILL.md loading on later requests is
    // instant. Fire-and-forget: a failure only means the first request rebuilds
    // it lazily (the existing fallback already degrades silently).
    const { getSkillRegistry } = await import('@/lib/skills/registry')
    const { detectRequestCapabilities } = await import(
      '@/lib/skills/capability-detection'
    )
    Promise.all([
      getSkillRegistry().catch(() => {}),
      detectRequestCapabilities('', []).catch(() => {})
    ]).then(() =>
      console.log('[skills] routing index pre-warmed for fast first token')
    )
  }
}
