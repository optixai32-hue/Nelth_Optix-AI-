import { describe, expect, it } from 'vitest'

import {
  createVoiceAgent,
  VOICE_MAX_OUTPUT_TOKENS,
  VOICE_MODEL_ID,
  VOICE_SYSTEM_PROMPT,
  voiceModelString
} from '@/lib/agents/voice-agent'

/**
 * The voice model runs on its own dedicated contract (identity + voice
 * behavior only). These assertions lock that in — the normal chat path's
 * long prompt machinery must never leak in here.
 */
describe('voice agent isolation', () => {
  it('uses the dedicated Nelth-IA Voice prompt verbatim', () => {
    expect(VOICE_SYSTEM_PROMPT).toContain('Nelth-IA Voice')
    expect(VOICE_SYSTEM_PROMPT).toContain('Optix AI')
    expect(VOICE_SYSTEM_PROMPT).toContain('TODIARISON Yannick Jonathan')
    expect(VOICE_SYSTEM_PROMPT).toContain(
      'RANDRIANAVAHANA Julie Fenitra Nelcia'
    )
    expect(VOICE_SYSTEM_PROMPT).toContain('REALTIME CONVERSATION')
    // None of the heavy chat-pipeline machinery vocabulary belongs here.
    for (const banned of [
      'ACTIVE SKILL',
      'TOOL CALL PROTOCOL',
      'Related Questions',
      'CITATION',
      'chain-of-thought'
    ]) {
      expect(VOICE_SYSTEM_PROMPT).not.toContain(banned)
    }
  })

  it('drives NVIDIA Nemotron with a 1024-token cap', () => {
    expect(VOICE_MODEL_ID).toBe('nvidia/nemotron-3.5-lightning-30b-a3b')
    expect(voiceModelString()).toBe(
      'openai-compatible:nvidia/nemotron-3.5-lightning-30b-a3b'
    )
    expect(VOICE_MAX_OUTPUT_TOKENS).toBe(1024)
  })

  it('builds a tool-less agent (no fallback model exists)', () => {
    const agent = createVoiceAgent({})
    expect(agent.tools).toEqual({})
  })
})
