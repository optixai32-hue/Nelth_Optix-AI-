import { describe, expect, it } from 'vitest'

import {
  isIdentityQuery,
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

  it('strips a replayed Qui suis-je self-intro section before real content', () => {
    const text = [
      'Qui suis-je ? 🤖',
      'Je suis Nelth-IA, un assistant avancé développé par Optix AI.',
      '',
      'Elon Musk — Portrait et informations clés 🔍',
      'Voici ce que les sources nous apprennent.'
    ].join('\n')
    expect(stripLeadingIntroReset(text)).toBe(
      [
        'Elon Musk — Portrait et informations clés 🔍',
        'Voici ce que les sources nous apprennent.'
      ].join('\n')
    )
  })

  it('keeps the self-intro when the question is about identity', () => {
    const text = [
      'Je suis Nelth-IA, un assistant avancé conçu par Optix AI.',
      '',
      'Je vous aide à chercher, créer et coder.'
    ].join('\n')
    expect(stripLeadingIntroReset(text, { keepSelfIntro: true })).toBe(text)
  })

  it('still strips the greeting but keeps the intro for identity questions', () => {
    const text = [
      'Bonjour ! 👋',
      '',
      'Je suis Nelth-IA, un assistant avancé conçu par Optix AI.'
    ].join('\n')
    expect(stripLeadingIntroReset(text, { keepSelfIntro: true })).toBe(
      'Je suis Nelth-IA, un assistant avancé conçu par Optix AI.'
    )
  })
})

describe('isIdentityQuery', () => {
  it.each([
    'qui es-tu ?',
    'Qui es tu',
    'who are you?',
    'présente-toi',
    'ton nom ?',
    't\u2019es qui ?'
  ])('detects %s as identity', q => {
    expect(isIdentityQuery(q)).toBe(true)
  })

  it.each([
    'recherche moi Elon Musk',
    "c'est qui Elon Musk ?",
    'parle-moi de Tesla',
    'bonjour'
  ])('does not flag %s as identity', q => {
    expect(isIdentityQuery(q)).toBe(false)
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
