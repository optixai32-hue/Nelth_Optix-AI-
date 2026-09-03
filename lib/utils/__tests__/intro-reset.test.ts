import { describe, expect, it } from 'vitest'

import {
  StreamTextSanitizer,
  stripLeadingIntroReset
} from '@/lib/utils/message-utils'

describe('stripLeadingIntroReset', () => {
  it('strips a greeting + self-intro before real content', () => {
    const text = [
      'Salut ! 👋 Ravi de vous revoir.',
      '',
      'Je suis Nelth-IA, l\u2019assistant intelligent développé par Optix AI. Je suis là pour vous aider.',
      '',
      'Parlons d\u2019Elon Musk ! Voici ce que j\u2019ai trouvé.'
    ].join('\n')
    expect(stripLeadingIntroReset(text)).toBe(
      'Parlons d\u2019Elon Musk ! Voici ce que j\u2019ai trouvé.'
    )
  })

  it('keeps the self-intro when it IS the answer (qui es-tu)', () => {
    const text = [
      'Bonjour ! 👋 Ravi de vous rencontrer.',
      '',
      'Je suis Nelth-IA, un assistant avancé conçu par Optix AI.'
    ].join('\n')
    expect(stripLeadingIntroReset(text)).toBe(
      'Je suis Nelth-IA, un assistant avancé conçu par Optix AI.'
    )
  })

  it('leaves normal answers untouched', () => {
    const text = 'Elon Musk est le CEO de Tesla et SpaceX.'
    expect(stripLeadingIntroReset(text)).toBe(text)
  })

  it('never nukes a greeting-only response', () => {
    const text = 'Bonjour ! Que puis-je faire pour vous ?'
    expect(stripLeadingIntroReset(text)).toBe(text)
  })
})

describe('StreamTextSanitizer intro reset', () => {
  it('holds and strips the reset across deltas when enabled', () => {
    const s = new StreamTextSanitizer({ stripLeadingIntroReset: true })
    // Greeting arrives in pieces — nothing emitted until decisive.
    expect(s.process('Salut ! ')).toBe('')
    expect(s.process('👋 Ravi de vous revoir.\n\n')).toBe('')
    // Real content flows after the strip.
    const out = s.process('Voici la réponse.')
    expect(out).toContain('Voici la réponse.')
    expect(out).not.toContain('Salut')
    expect(s.flush()).toBe('')
  })

  it('streams normally when disabled', () => {
    const s = new StreamTextSanitizer()
    expect(s.process('Bonjour ! ')).toBe('Bonjour ! ')
  })
})
