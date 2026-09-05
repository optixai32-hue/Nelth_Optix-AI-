import type { UIMessage } from 'ai'

import { getTextFromParts } from '@/lib/utils/message-utils'

const VOICE_HISTORY_MESSAGES = 6
const VOICE_HISTORY_CHARS = 1000

/**
 * Text-only history window for voice turns.
 *
 * The voice agent owns zero tools, so replaying tool calls, tool results,
 * file parts, or data parts would be dead weight at best — and a provider
 * error at worst. Keep the last few turns as plain text so follow-ups
 * ("et après ?", "le deuxième") still resolve. Exported for unit testing.
 */
export function toVoiceHistory(messages: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    let text = ''
    try {
      text = getTextFromParts(message.parts)
        .trim()
        .slice(0, VOICE_HISTORY_CHARS)
    } catch {
      continue
    }
    if (!text) continue
    out.push({ ...message, parts: [{ type: 'text', text }] })
  }
  return out.slice(-VOICE_HISTORY_MESSAGES)
}
