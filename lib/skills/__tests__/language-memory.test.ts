import { describe, expect, it } from 'vitest'

import {
  buildLanguageLayer,
  detectLanguage,
  findExplicitLanguageRequest,
  messageTextAny,
  resolveConversationLanguage
} from '@/lib/skills/language-memory'

const u = (text: string) => ({
  role: 'user',
  parts: [{ type: 'text', text }]
})
const a = (text: string) => ({
  role: 'assistant',
  parts: [{ type: 'text', text }]
})

describe('findExplicitLanguageRequest', () => {
  it('detects the Malagasy request in any case', () => {
    expect(findExplicitLanguageRequest('ATAOVO TENY MALAGASY')).toBe('mg')
    expect(findExplicitLanguageRequest('Ataovy teny malagasy azafady')).toBe(
      'mg'
    )
  })
  it('detects French and English requests', () => {
    expect(
      findExplicitLanguageRequest('Maintenant explique-moi en français.')
    ).toBe('fr')
    expect(findExplicitLanguageRequest('Answer in English please')).toBe('en')
  })
  it('returns null without an explicit request', () => {
    expect(findExplicitLanguageRequest('Azavao indray ilay OAuth')).toBeNull()
    expect(findExplicitLanguageRequest('')).toBeNull()
  })
})

describe('detectLanguage', () => {
  it('detects Malagasy, French and English', () => {
    expect(detectLanguage('Azavao indray ilay OAuth azafady')).toBe('mg')
    expect(detectLanguage('Salama, inona no vaovao?')).toBe('mg')
    expect(detectLanguage('Explique-moi ce concept en détail')).toBe('fr')
    expect(detectLanguage('Explain this concept in detail please')).toBe('en')
  })
  it('returns unknown on ties and empties', () => {
    expect(detectLanguage('')).toBe('unknown')
    expect(detectLanguage('OK')).toBe('unknown')
  })
})

describe('resolveConversationLanguage', () => {
  it('current explicit request wins immediately', () => {
    expect(
      resolveConversationLanguage([], 'ATAOVO TENY MALAGASY')
    ).toEqual({ lang: 'mg', source: 'requested' })
  })

  it('persists the preference from history across turns', () => {
    const history = [
      u('Connector card Google Drive'),
      a('Explication des connectors...'),
      u('ATAOVO TENY MALAGASY'),
      a('Fanazavana amin ny teny Malagasy...')
    ]
    expect(resolveConversationLanguage(history, 'Azavao indray ilay OAuth')).toEqual({
      lang: 'mg',
      source: 'requested'
    })
  })

  it('a newer explicit request overrides the older preference', () => {
    const history = [u('ATAOVO TENY MALAGASY'), a('...malagasy...')]
    expect(
      resolveConversationLanguage(history, 'Maintenant en français.')
    ).toEqual({ lang: 'fr', source: 'requested' })
  })

  it('falls back to detection without any preference', () => {
    expect(resolveConversationLanguage([], 'Azavao kely')).toEqual({
      lang: 'mg',
      source: 'detected'
    })
  })

  it('returns null with no signal at all', () => {
    expect(resolveConversationLanguage([], 'OK')).toBeNull()
  })
})

describe('messageTextAny', () => {
  it('reads UIMessage parts and ModelMessage content', () => {
    expect(messageTextAny(u('hello') as never)).toBe('hello')
    expect(
      messageTextAny({ role: 'user', content: 'hi there' } as never)
    ).toBe('hi there')
    expect(
      messageTextAny({
        role: 'user',
        content: [{ type: 'text', text: 'a' }, { type: 'image', image: 'x' }]
      } as never)
    ).toBe('a')
    expect(messageTextAny(null)).toBe('')
  })
})

describe('buildLanguageLayer', () => {
  it('builds the persistence + anti-restart block', () => {
    const layer = buildLanguageLayer({ lang: 'mg', source: 'requested' })
    expect(layer).toContain('Malagasy')
    expect(layer).toContain('ATAOVO TENY MALAGASY')
    expect(layer).toContain('KEEP')
  })
  it('returns empty without a resolved language', () => {
    expect(buildLanguageLayer(null)).toBe('')
  })
})
