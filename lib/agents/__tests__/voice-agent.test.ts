import { describe, expect, it } from 'vitest'

import {
  createVoiceAgent,
  VOICE_MAX_OUTPUT_TOKENS,
  VOICE_SYSTEM_PROMPT
} from '@/lib/agents/voice-agent'

/**
 * The voice model must stay on a tiny isolated contract: identity +
 * brevity, no skill/rule/tool machinery. These assertions lock that in —
 * the normal chat path must never leak its long prompt here.
 */
describe('voice agent isolation', () => {
  it('uses a short voice-only system prompt', () => {
    expect(VOICE_SYSTEM_PROMPT).toContain('Nelth')
    expect(VOICE_SYSTEM_PROMPT).toContain('SHORT')
    expect(VOICE_SYSTEM_PROMPT.length).toBeLessThan(1200)
    // None of the heavy machinery vocabulary belongs here.
    for (const banned of [
      'ACTIVE SKILL',
      'TOOL CALL PROTOCOL',
      'ARTIFACT',
      'CITATION',
      'Related Questions'
    ]) {
      expect(VOICE_SYSTEM_PROMPT).not.toContain(banned)
    }
  })

  it('caps output tokens for spoken answers', () => {
    expect(VOICE_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(400)
    expect(VOICE_MAX_OUTPUT_TOKENS).toBeGreaterThan(0)
  })

  it('builds a tool-less agent', () => {
    const agent = createVoiceAgent({
      model: 'kilo-gateway:minimax/minimax-m3:free'
    })
    expect(agent.tools).toEqual({})
  })
})
