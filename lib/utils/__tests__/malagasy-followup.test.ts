import { describe, expect, it } from 'vitest'

import {
  isIdentityQuery,
  isPureGreeting,
  resolveContextualSearchQuery,
  stripLeadingIntroReset
} from '@/lib/utils/message-utils'

const u = (text: string) => ({
  role: 'user',
  parts: [{ type: 'text', text }]
})
const a = (text: string) => ({
  role: 'assistant',
  parts: [{ type: 'text', text }]
})

describe('Malagasy follow-ups use previous context', () => {
  it('merges a pronoun follow-up with the previous subject', () => {
    const history = [
      u('Iza moa Elon Musk?'),
      a('Elon Musk dia ...'),
      u('Inona avy ireo orinasa ataony?')
    ]
    const q = resolveContextualSearchQuery(
      'Inona avy ireo orinasa ataony?',
      history as never
    )
    expect(q).not.toBe('Inona avy ireo orinasa ataony?')
    expect(q.toLowerCase()).toContain('elon musk')
  })

  it('treats Salama as a greeting (no search merge)', () => {
    expect(isPureGreeting('Salama!')).toBe(true)
    expect(isPureGreeting('Manao ahoana!')).toBe(true)
  })

  it('never treats ATAOVO TENY MALAGASY as a greeting', () => {
    expect(isPureGreeting('ATAOVO TENY MALAGASY')).toBe(false)
  })

  it('detects Malagasy identity questions (protects the intro)', () => {
    expect(isIdentityQuery('Iza ianao?')).toBe(true)
    expect(isIdentityQuery('Ahoana ny anaranao?')).toBe(true)
  })

  it('strips a Malagasy greeting reset mid-conversation', () => {
    const text = [
      'Salama! Faly mahita anao indray.',
      '',
      'Ity ny valiny.'
    ].join('\n')
    expect(stripLeadingIntroReset(text)).toBe('Ity ny valiny.')
  })
})
