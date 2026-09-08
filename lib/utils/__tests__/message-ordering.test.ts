import { describe, expect, it } from 'vitest'

import {
  compareMessagesForOrder,
  dedupeConsecutiveDuplicates,
  sortMessagesForOrder
} from '../message-ordering'

function msg(
  id: string,
  createdAt: string,
  sequence?: number
): { id: string; createdAt: string; sequence?: number } {
  return { id, createdAt, sequence }
}

describe('compareMessagesForOrder', () => {
  it('orders by sequence ASC when both have a sequence', () => {
    const a = msg('a', '2024-01-01T00:00:00Z', 1)
    const b = msg('b', '2024-01-01T00:00:00Z', 2)
    const c = msg('c', '2024-01-01T00:00:00Z', 3)
    expect(
      [c, a, b].sort(compareMessagesForOrder).map(m => m.sequence)
    ).toEqual([1, 2, 3])
  })

  it('falls back to createdAt ASC when sequences are missing', () => {
    const a = msg('a', '2024-01-01T00:00:00Z')
    const b = msg('b', '2024-01-01T00:00:05Z')
    const c = msg('c', '2024-01-01T00:00:10Z')
    expect([c, a, b].sort(compareMessagesForOrder).map(m => m.id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('keeps legacy (no sequence) before newly sequenced messages when legacy is older', () => {
    const legacy1 = msg('u1', '2024-01-01T00:00:00Z') // user 1 (no sequence)
    const legacy2 = msg('a1', '2024-01-01T00:00:01Z') // assistant 1 (no sequence)
    const newUser = msg('u2', '2024-01-01T00:05:00Z', 1)
    const newAssistant = msg('a2', '2024-01-01T00:05:01Z', 2)

    const ordered = [newAssistant, newUser, legacy2, legacy1].sort(
      compareMessagesForOrder
    )
    expect(ordered.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('is stable for equal createdAt using the id tiebreak', () => {
    const a = msg('a', '2024-01-01T00:00:00Z')
    const b = msg('b', '2024-01-01T00:00:00Z')
    expect([b, a].sort(compareMessagesForOrder).map(m => m.id)).toEqual([
      'a',
      'b'
    ])
  })

  it('sortMessagesForOrder returns a new array', () => {
    const input = [
      msg('b', '2024-01-02T00:00:00Z', 2),
      msg('a', '2024-01-01T00:00:00Z', 1)
    ]
    const out = sortMessagesForOrder(input)
    expect(out.map(m => m.id)).toEqual(['a', 'b'])
    expect(out).not.toBe(input)
  })
})

describe('dedupeConsecutiveDuplicates', () => {
  it('removes a duplicate assistant (AI2, AI2) keeping the first', () => {
    const a1 = {
      id: 'a1',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'hello' }]
    }
    const a2 = {
      id: 'a2',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'hello' }]
    }
    const out = dedupeConsecutiveDuplicates([a1, a2])
    expect(out).toEqual([a1])
  })

  it('collapses consecutive assistants with different content (retry duplicate)', () => {
    const a1 = {
      id: 'a1',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'one' }]
    }
    const a2 = {
      id: 'a2',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'two completely different' }]
    }
    expect(dedupeConsecutiveDuplicates([a1, a2])).toEqual([a1])
  })

  it('collapses User, User, Assistant into User, Assistant', () => {
    const u1 = {
      id: 'u1',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'hi' }]
    }
    const u2 = {
      id: 'u2',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'hi' }]
    }
    const a1 = {
      id: 'a1',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'yo' }]
    }
    const out = dedupeConsecutiveDuplicates([u1, u2, a1])
    expect(out.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('produces strict USER -> AI alternation', () => {
    const u1 = {
      id: 'u1',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'q1' }]
    }
    const a1 = {
      id: 'a1',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'r1' }]
    }
    const u2 = {
      id: 'u2',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'q2' }]
    }
    const a2a = {
      id: 'a2a',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'r2' }]
    }
    const a2b = {
      id: 'a2b',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'r2' }]
    }
    const out = dedupeConsecutiveDuplicates([u1, a1, u2, a2a, a2b])
    expect(out.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2a'])
  })
})
