import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { compactHistoricalMessages } from '@/lib/streaming/helpers/compact-historical-messages'
import { normalizeConversationHistory } from '@/lib/streaming/helpers/normalize-conversation'

function user(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as UIMessage
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as UIMessage
}

function assistantToolOnly(id: string, output: unknown): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'tool-generateImage', state: 'output-available', output }]
  } as unknown as UIMessage
}

describe('normalizeConversationHistory — one authoritative history flow', () => {
  it('keeps a clean chronological conversation untouched', () => {
    const messages = [
      user('u1', 'What is the capital of France?'),
      assistant('a1', 'Paris.'),
      user('u2', 'And Germany?')
    ]
    const { messages: out, droppedDuplicates, droppedEmpties } =
      normalizeConversationHistory(messages)
    expect(out).toHaveLength(3)
    expect(droppedDuplicates).toBe(0)
    expect(droppedEmpties).toBe(0)
    // Chronological, alternating, current user message last and exactly once.
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out.filter(m => m.id === 'u2')).toHaveLength(1)
    expect((out[2] as { id: string }).id).toBe('u2')
  })

  it('drops a stale duplicate of the current user message (keeps the last)', () => {
    const stale = user('u2', 'And Germany?')
    const fresh = {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'And Germany? (signed)' }]
    } as unknown as UIMessage
    const messages = [user('u1', 'Q1'), assistant('a1', 'A1'), stale, fresh]
    const { messages: out, droppedDuplicates } =
      normalizeConversationHistory(messages)
    expect(out.filter(m => (m as { id: string }).id === 'u2')).toHaveLength(1)
    expect(droppedDuplicates).toBe(1)
    expect((out[out.length - 1] as { id: string }).id).toBe('u2')
  })

  it('drops back-to-back identical assistant messages (stream finalization dupes)', () => {
    const messages = [
      user('u1', 'Hi'),
      assistant('a1', 'Hello!'),
      { ...assistant('a1b', 'Hello!') }
    ]
    const { messages: out, droppedDuplicates } =
      normalizeConversationHistory(messages)
    expect(out).toHaveLength(2)
    expect(droppedDuplicates).toBe(1)
  })

  it('drops contentless messages but never the last one', () => {
    const empty = { id: 'e1', role: 'assistant', parts: [] } as UIMessage
    const messages = [user('u1', 'Hi'), empty, user('u2', 'And?')]
    const { messages: out, droppedEmpties } =
      normalizeConversationHistory(messages)
    expect(out.map(m => (m as { id: string }).id)).toEqual(['u1', 'u2'])
    expect(droppedEmpties).toBe(1)
  })

  it('keeps tool-only turns (they carry meaning for follow-ups)', () => {
    const messages = [
      user('u1', 'Create a house'),
      assistantToolOnly('a1', { imageUrl: 'https://img/1.png' }),
      user('u2', 'Make it bigger')
    ]
    const { messages: out } = normalizeConversationHistory(messages)
    expect(out).toHaveLength(3)
  })

  it('handles null/undefined/empty input', () => {
    expect(normalizeConversationHistory(null).messages).toEqual([])
    expect(normalizeConversationHistory(undefined).messages).toEqual([])
    expect(normalizeConversationHistory([]).messages).toEqual([])
  })

  it('survives a long conversation: order kept, last message last', () => {
    const messages: UIMessage[] = []
    for (let i = 0; i < 10; i++) {
      messages.push(user(`u${i}`, `Question ${i}`))
      messages.push(assistant(`a${i}`, `Answer ${i}.`))
    }
    messages.push(user('u10', 'One more?'))
    const { messages: out } = normalizeConversationHistory(messages)
    expect(out).toHaveLength(21)
    expect((out[0] as { id: string }).id).toBe('u0')
    expect((out[20] as { id: string }).id).toBe('u10')
  })
})

describe('compactHistoricalMessages — artifact turns survive as markers', () => {
  it('preserves a textless image turn as a one-line marker', () => {
    const messages = [
      user('u1', 'Create a Chinese-style house'),
      assistantToolOnly('a1', { imageUrl: 'https://img/house.png' }),
      user('u2', 'Make it bigger')
    ]
    const out = compactHistoricalMessages(messages)
    const markerTurn = out.find(m => (m as { id: string }).id === 'a1')
    expect(markerTurn).toBeDefined()
    const text = (markerTurn!.parts as { text?: string }[])
      .map(p => p.text ?? '')
      .join(' ')
    expect(text).toContain('https://img/house.png')
    expect(text).toContain('generated an image')
  })

  it('still drops pure execution traces with no artifact', () => {
    const messages = [
      user('u1', 'Hi'),
      assistantToolOnly('a1', { state: 'complete' }),
      user('u2', 'Hello?')
    ]
    const out = compactHistoricalMessages(messages)
    expect(out.find(m => (m as { id: string }).id === 'a1')).toBeUndefined()
  })
})
