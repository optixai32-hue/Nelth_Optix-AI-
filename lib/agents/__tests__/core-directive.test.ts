import { describe, expect, it } from 'vitest'

import {
  CONVERSATIONAL_BEHAVIOR,
  NON_THINKING_CORE_DIRECTIVE
} from '@/lib/agents/researcher'

/**
 * Regression test for the "ok merci → calendar denial" bug: after the
 * assistant successfully used a connected app, a thank-you follow-up made
 * the model claim it had no access. Both prompt contracts must forbid
 * contradicting the thread history.
 */
describe('core directive continuity', () => {
  it('weak header keeps thread continuity and forbids false denials', () => {
    expect(NON_THINKING_CORE_DIRECTIVE).toContain('THREAD CONTINUITY')
    expect(NON_THINKING_CORE_DIRECTIVE).toContain(
      'NEVER claim you lack access to something you already used or showed above'
    )
    expect(NON_THINKING_CORE_DIRECTIVE).toContain('brief warm reply')
  })

  it('conversational behavior covers thank-you turns', () => {
    expect(CONVERSATIONAL_BEHAVIOR).toContain('thanks')
    expect(CONVERSATIONAL_BEHAVIOR).toContain('NEVER deny access')
  })
})
