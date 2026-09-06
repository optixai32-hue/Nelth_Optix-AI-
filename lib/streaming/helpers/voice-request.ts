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
 * The marker part is stripped from the current message AND from the whole
 * `messages` history (the client keeps it in memory) so it is never
 * persisted, never shown to any model, and never leaks into later turns —
 * in ANY trigger (submit, regenerate, reload). Exported for unit testing.
 */
export function detectVoiceRequest(body: {
  voiceMode?: unknown
  message?: { parts?: unknown }
  messages?: Array<{ parts?: unknown }>
}): boolean {
  if (!body || typeof body !== 'object') return false
  let found = body.voiceMode === true
  if (stripVoiceMarker(body.message?.parts)) found = true
  for (const m of body.messages ?? []) {
    stripVoiceMarker(m?.parts)
  }
  return found
}

function stripVoiceMarker(parts: unknown): boolean {
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
