import { describe, expect, it } from 'vitest'

import { compactHistoricalMessages } from '../compact-historical-messages'

function userMsg(id: string, text: string): any {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

function gmailAssistantMsg(id: string, withText: boolean): any {
  return {
    id,
    role: 'assistant',
    parts: [
      ...(withText
        ? [{ type: 'text', text: 'Voici vos mails : facture et newsletter.' }]
        : []),
      {
        type: 'tool-gmail',
        toolCallId: 'c1',
        state: 'output-available',
        input: { action: 'search', query: '' },
        output: {
          state: 'complete',
          items: [
            {
              id: 'm1',
              subject: 'Facture',
              from: 'shop@x.com',
              date: 'Mon',
              snippet: 'Total 42€'
            },
            { id: 'm2', subject: 'Newsletter', from: 'n@y.com', date: 'Tue' }
          ]
        }
      }
    ]
  }
}

describe('compactHistoricalMessages connector retention', () => {
  it('keeps connector data alongside prose on recent turns', () => {
    const out = compactHistoricalMessages([
      userMsg('u1', 'résume mes mails'),
      gmailAssistantMsg('a1', true)
    ] as any)
    const assistant = out.find((m: any) => m.id === 'a1') as any
    expect(assistant).toBeDefined()
    const texts = assistant.parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
    // Original prose survives…
    expect(texts.some((t: string) => t.includes('Voici vos mails'))).toBe(true)
    // …and the raw connector data is retained as context.
    const ctx = texts.find((t: string) => t.includes('<connector_context>'))
    expect(ctx).toBeDefined()
    expect(ctx).toContain('Facture')
    expect(ctx).toContain('shop@x.com')
  })

  it('preserves tool-only connector turns instead of dropping them', () => {
    const out = compactHistoricalMessages([
      userMsg('u1', 'résume mes mails'),
      gmailAssistantMsg('a1', false)
    ] as any)
    const assistant = out.find((m: any) => m.id === 'a1') as any
    expect(assistant).toBeDefined()
    expect(assistant.parts).toHaveLength(1)
    expect(assistant.parts[0].text).toContain('<connector_context>')
    expect(assistant.parts[0].text).toContain('Facture')
  })

  it('still drops pure execution traces without connector data', () => {
    const out = compactHistoricalMessages([
      userMsg('u1', 'cherche quelque chose'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-search',
            toolCallId: 's1',
            state: 'output-available',
            input: { query: 'x' },
            output: { state: 'complete', results: [] }
          }
        ]
      }
    ] as any)
    expect(out.find((m: any) => m.id === 'a1')).toBeUndefined()
  })

  it('marks auth-required connector states for reconnect', () => {
    const out = compactHistoricalMessages([
      userMsg('u1', 'résume mes mails'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Je vais regarder.' },
          {
            type: 'tool-gmail',
            toolCallId: 'c1',
            state: 'output-available',
            input: { action: 'search', query: '' },
            output: { state: 'auth-required', provider: 'Google' }
          }
        ]
      }
    ] as any)
    const assistant = out.find((m: any) => m.id === 'a1') as any
    const ctx = assistant.parts
      .map((p: any) => p.text ?? '')
      .find((t: string) => t.includes('<connector_context>'))
    expect(ctx).toContain('reconnexion requise')
  })
})
