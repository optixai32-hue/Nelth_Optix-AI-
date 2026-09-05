import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { toVoiceHistory } from '../voice-history'

function msg(
  id: string,
  role: 'user' | 'assistant',
  parts: Array<{ type: string; text?: string }>
): UIMessage {
  return { id, role, parts } as unknown as UIMessage
}

describe('toVoiceHistory', () => {
  it('keeps recent text turns and drops tool/file parts', () => {
    const out = toVoiceHistory([
      msg('u1', 'user', [{ type: 'text', text: 'résume mes mails' }]),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-gmail',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { state: 'complete', items: [] }
          } as never,
          { type: 'text', text: 'Voici vos 3 mails.' }
        ]
      } as unknown as UIMessage,
      msg('u2', 'user', [{ type: 'text', text: 'et le deuxième ?' }])
    ])
    expect(out).toHaveLength(3)
    // Assistant turn is text-only now.
    expect(out[1].parts).toEqual([{ type: 'text', text: 'Voici vos 3 mails.' }])
  })

  it('drops contentless and non-chat messages', () => {
    const out = toVoiceHistory([
      msg('u1', 'user', [{ type: 'text', text: '   ' }]),
      msg('a1', 'assistant', [{ type: 'text', text: 'ok' }])
    ])
    expect(out.map(m => m.id)).toEqual(['a1'])
  })

  it('keeps only the last 6 messages', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', [
        { type: 'text', text: `turn ${i}` }
      ])
    )
    const out = toVoiceHistory(many)
    expect(out).toHaveLength(6)
    expect(out[0].id).toBe('m4')
  })

  it('truncates long turns', () => {
    const out = toVoiceHistory([
      msg('u1', 'user', [{ type: 'text', text: 'x'.repeat(5000) }])
    ])
    const text = (out[0].parts[0] as { text: string }).text
    expect(text.length).toBeLessThanOrEqual(1000)
  })
})
