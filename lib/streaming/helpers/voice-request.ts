/**
 * Voice-request detection shared by the chat route.
 *
 * Voice turns are flagged TWO ways (belt and braces — SDK option forwarding
 * has proven unreliable across versions):
 *  1. `body.voiceMode === true` (useChat per-request options), and
 *  2. an in-band `data-voiceMode` part on the submitted message, which
 *     travels inside the message itself and therefore cannot be dropped by
 *     any transport wrapper.
 *
 * The marker part is stripped here so it is never persisted, never shown to
 * the model, and never leaks into later turns. Exported for unit testing.
 */
export function detectVoiceRequest(body: {
  voiceMode?: unknown
  message?: { parts?: unknown }
}): boolean {
  if (!body || typeof body !== 'object') return false
  if ((body as { voiceMode?: unknown }).voiceMode === true) return true
  const parts = (body as { message?: { parts?: unknown } }).message?.parts
  if (!Array.isArray(parts)) return false
  const idx = parts.findIndex(
    (p: unknown) =>
      !!p &&
      typeof p === 'object' &&
      (p as { type?: unknown }).type === 'data-voiceMode'
  )
  if (idx === -1) return false
  parts.splice(idx, 1)
  return true
}
