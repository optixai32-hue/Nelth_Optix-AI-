import { describe, expect, it } from 'vitest'

import {
  CONVERSATIONAL_BEHAVIOR,
  CORE_DIRECTIVE_TEXT,
  FULL_CORE_DIRECTIVE
} from '@/lib/agents/researcher'

/**
 * Regression tests for prompt-contract coverage:
 * - "ok merci → calendar denial": the contract must forbid contradicting
 *   thread history (connected apps, files, mails already used above).
 * - Weak-model quality: BOTH models receive the FULL contract — no compact
 *   header that drops identity, continuity, or tool-use rules.
 */
describe('core directive continuity', () => {
  it('full directive keeps thread continuity and forbids false denials', () => {
    expect(FULL_CORE_DIRECTIVE).toContain('CONVERSATION CONTINUITY')
    expect(FULL_CORE_DIRECTIVE).toContain('ACTIVE SKILL')
    expect(FULL_CORE_DIRECTIVE).toContain('NON-NEGOTIABLE')
  })

  it('full directive embeds the complete core text and behavior', () => {
    expect(FULL_CORE_DIRECTIVE).toContain(CORE_DIRECTIVE_TEXT.slice(0, 60))
    expect(FULL_CORE_DIRECTIVE).toContain('CONVERSATIONAL BEHAVIOR')
    // Substantially complete: identity + 26 rules + behavior + overrides.
    expect(FULL_CORE_DIRECTIVE.length).toBeGreaterThan(8000)
  })

  it('conversational behavior covers thank-you turns', () => {
    expect(CONVERSATIONAL_BEHAVIOR).toContain('thanks')
    expect(CONVERSATIONAL_BEHAVIOR).toContain('NEVER deny access')
  })
})
