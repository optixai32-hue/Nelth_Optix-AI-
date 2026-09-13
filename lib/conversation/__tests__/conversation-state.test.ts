import { describe, expect, it } from 'vitest'

import {
  buildConversationStateLayer,
  type ConversationTurnInput,
  extractOfferedOptions,
  extractTrailingQuestion,
  isFollowUpReference,
  isGreetingLike,
  isShortConfirmation,
  trackConversationState} from '@/lib/conversation/conversation-state'

/**
 * Regression test for the "branch relapse" bug:
 *
 *   User: azure stt free no limit
 *   AI:   …Azure… "Want me to look up pricing, or compare with free alternatives?"
 *   User: oui
 *   AI:   …Azure… "Tu veux des détails sur les prix ou une alternative open-source ?"
 *   User: oui
 *   AI:   …alternatives… "Tu veux un exemple d'installation ou un script Python ?"
 *   User: recherche l'open free
 *   AI:   …Whisper, Vosk… "Tu veux un exemple d'installation ou un script Python ?"
 *   User: ok
 *   AI:   ❌ "Voici le comparatif… Guide : configurer l'API Azure" (MUST NOT happen)
 *
 * The final answer MUST stay on "open-source/free STT" and must never drift
 * back to Azure configuration.
 */

const ASSISTANT_AZURE_1 = `Azure Speech-to-Text has a free tier: 5 hours of audio per month.
Want me to look up the exact current pay-as-you-go pricing per region, or compare Azure STT with other free STT alternatives?`

const ASSISTANT_AZURE_2 = `Azure details: 5 hours/month STT + 5M characters TTS.
Tu veux des détails sur les prix ou une alternative open-source ?`

const ASSISTANT_AZURE_3 = `Comparatif Azure Speech-to-Text vs Whisper vs Google.
Tu veux un exemple d'installation ou un script Python pour l'une de ces alternatives ?`

const ASSISTANT_OPEN_1 = `Options open-source gratuites : Whisper (local, précis), Vosk (léger, temps réel), Moonshine (rapide).
Tu veux un exemple d'installation ou un script Python pour l'une de ces alternatives ?`

function turns(...msgs: Array<[string, string]>): ConversationTurnInput[] {
  return msgs.map(([role, text]) => ({ role, text }))
}

describe('conversation continuity — azure → open-free → ok relapse', () => {
  it('moves the active topic to open-source STT on explicit switch', () => {
    const state = trackConversationState(
      turns(
        ['user', 'azure stt free no limit'],
        ['assistant', ASSISTANT_AZURE_1],
        ['user', 'oui'],
        ['assistant', ASSISTANT_AZURE_2],
        ['user', 'oui'],
        ['assistant', ASSISTANT_AZURE_3],
        ['user', 'recherche l\u2019open free']
      )
    )
    expect(state.lastUserIntent).toBe('new_request')
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)
    expect(state.previousTopic?.toLowerCase()).toMatch(/azure/)
    expect(state.pendingClarification).toBe(false)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('NEW active topic')
    expect(layer).toContain('historical context only')
  })

  it('keeps "ok" on the open-source topic and demands clarification (never Azure)', () => {
    const state = trackConversationState(
      turns(
        ['user', 'azure stt free no limit'],
        ['assistant', ASSISTANT_AZURE_1],
        ['user', 'oui'],
        ['assistant', ASSISTANT_AZURE_2],
        ['user', 'oui'],
        ['assistant', ASSISTANT_AZURE_3],
        ['user', 'recherche l\u2019open free'],
        ['assistant', ASSISTANT_OPEN_1],
        ['user', 'ok']
      )
    )
    // The active topic MUST still be open-source/free STT — not Azure.
    expect(state.lastUserIntent).toBe('confirmation')
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)
    expect(state.activeTopic.toLowerCase()).not.toContain('azure')

    // "ok" follows a multi-option question → ambiguous → clarify, don't pick.
    expect(state.ambiguousConfirmation).toBe(true)
    expect(state.pendingClarification).toBe(true)
    expect(state.offeredOptions.length).toBeGreaterThanOrEqual(2)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('ONE concise clarification question')
    expect(layer).toContain('Do NOT choose a branch yourself')
    expect(layer).toContain('do NOT switch back to an older topic')
    // "azure" may only appear inside the explicit do-NOT-return quarantine
    // note — the directive must never steer back to the old topic.
    const azureMentions = layer.toLowerCase().split('azure').length - 1
    expect(azureMentions).toBeLessThanOrEqual(1)
    expect(layer).not.toMatch(/continue[^.]*azure/i)
  })

  it('flags "oui" after a multi-option question as pending clarification', () => {
    const state = trackConversationState(
      turns(
        ['user', 'azure stt free no limit'],
        ['assistant', ASSISTANT_AZURE_1],
        ['user', 'oui']
      )
    )
    expect(state.lastUserIntent).toBe('confirmation')
    expect(state.pendingClarification).toBe(true)
    expect(state.offeredOptions.length).toBeGreaterThanOrEqual(2)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('ONE concise clarification question')
  })

  it('treats "ok" after a question-free answer as plain continuation', () => {
    const state = trackConversationState(
      turns(
        ['user', 'recherche l\u2019open free'],
        ['assistant', 'Voici Whisper, Vosk et Moonshine en local, sans limite.'],
        ['user', 'ok']
      )
    )
    expect(state.lastUserIntent).toBe('confirmation')
    expect(state.pendingClarification).toBe(false)
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('Continue the active topic immediately')
    expect(layer).not.toContain('clarification question naming')
  })
})

describe('conversation state helpers', () => {
  it('detects short confirmations across FR/EN/MG', () => {
    for (const t of [
      'oui',
      'ok',
      'd\u2019accord',
      'vas-y',
      'continue',
      'yes',
      'eny',
      'Oui bien sûr'
    ])
      expect(isShortConfirmation(t)).toBe(true)
    expect(isShortConfirmation('recherche l\u2019open free')).toBe(false)
    expect(isShortConfirmation('oui, donne-moi les prix détaillés par région')).toBe(
      false
    )
    expect(isShortConfirmation('non')).toBe(false)
  })

  it('detects greetings and follow-up references', () => {
    expect(isGreetingLike('bonjour')).toBe(true)
    expect(isGreetingLike('merci')).toBe(true)
    expect(isGreetingLike('recherche l\u2019open free')).toBe(false)
    expect(isFollowUpReference('le plus rapide')).toBe(true)
    expect(isFollowUpReference('et sur mon PC ?')).toBe(true)
    expect(isFollowUpReference('et sans Python ?')).toBe(true)
    expect(isFollowUpReference('recherche l\u2019open free')).toBe(false)
  })

  it('extracts the trailing question and its options', () => {
    expect(extractTrailingQuestion(ASSISTANT_AZURE_1)).toContain(
      'compare Azure STT with other free STT alternatives?'
    )
    expect(
      extractOfferedOptions(
        'Tu veux des détails sur les prix ou une alternative open-source ?'
      )
    ).toEqual(['des détails sur les prix', 'une alternative open-source'])
    expect(
      extractOfferedOptions(
        'Tu veux un exemple d\u2019installation ou un script Python pour l\u2019une de ces alternatives ?'
      )
    ).toHaveLength(2)
    // Single yes/no question → no options.
    expect(extractOfferedOptions('Veux-tu que je continue ?')).toEqual([])
    // No question at all.
    expect(extractTrailingQuestion('Voici Whisper, Vosk et Moonshine.')).toBeNull()
  })

  it('emits no layer for greetings and first turns', () => {
    expect(
      buildConversationStateLayer(
        trackConversationState(turns(['user', 'bonjour']))
      )
    ).toBe('')
    expect(buildConversationStateLayer(trackConversationState([]))).toBe('')
  })

  it('keeps follow-ups on the active topic', () => {
    const state = trackConversationState(
      turns(
        ['user', 'recherche l\u2019open free'],
        ['assistant', ASSISTANT_OPEN_1],
        ['user', 'le plus rapide']
      )
    )
    expect(state.lastUserIntent).toBe('followup')
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)
    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('resolve pronouns')
  })
})
