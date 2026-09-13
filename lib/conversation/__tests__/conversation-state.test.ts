import { describe, expect, it } from 'vitest'

import {
  buildAffirmativeHint,
  buildConversationStateLayer,
  type ConversationTurnInput,
  extractOfferedOptions,
  extractPendingOffer,
  extractTrailingQuestion,
  isFollowUpReference,
  isGreetingLike,
  isGreetingOpener,
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

describe('affirmative hint builder', () => {
  const topicState = () =>
    trackConversationState(
      turns(
        ['user', 'recherche l\u2019open free'],
        ['assistant', ASSISTANT_OPEN_1]
      )
    )

  it('continues the exact topic when one is established', () => {
    const hint = buildAffirmativeHint({
      userReply: 'ok',
      lastAssistantText: 'Voici Whisper, Vosk et Moonshine.',
      state: topicState()
    })
    expect(hint).toContain('Continue THAT exact topic immediately')
  })

  it('clarifies instead of continuing on ambiguous multi-option replies', () => {
    const state = trackConversationState(
      turns(
        ['user', 'je cherche un STT'],
        ['assistant', 'Tu préfères Azure ou Open Source ?'],
        ['user', 'vas-y']
      )
    )
    const hint = buildAffirmativeHint({
      userReply: 'vas-y',
      lastAssistantText: 'Tu préfères Azure ou Open Source ?',
      state
    })
    expect(hint).toContain('ONE concise clarification question')
    expect(hint).not.toContain('Continue THAT exact topic')
  })

  it('returns undefined without an assistant message or for real requests', () => {
    const state = topicState()
    expect(
      buildAffirmativeHint({ userReply: 'ok', lastAssistantText: null, state })
    ).toBeUndefined()
    expect(
      buildAffirmativeHint({
        userReply: 'recherche l\u2019open free',
        lastAssistantText: 'Bonjour !',
        state
      })
    ).toBeUndefined()
  })

  it('detects assistant greeting openers', () => {
    expect(
      isGreetingOpener(
        'Bonjour ! 👋 Ravi de vous voir — une question ? Je vous écoute.'
      )
    ).toBe(true)
    expect(
      isGreetingOpener('Salut ! 👋 Ravi de vous voir, je suis là pour aider.')
    ).toBe(true)
    expect(isGreetingOpener('Voici Whisper, Vosk et Moonshine.')).toBe(false)
    expect(
      isGreetingOpener('Azure Speech-to-Text has a free tier: 5 hours/month.')
    ).toBe(false)
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
    expect(isFollowUpReference('et le TTS ?')).toBe(true)
    expect(isFollowUpReference('pourquoi ?')).toBe(true)
    expect(isFollowUpReference('quel est le prix ?')).toBe(true)
    expect(isFollowUpReference('recherche l\u2019open free')).toBe(false)
    // Self-contained new-domain questions must NOT be swallowed as follow-ups.
    expect(isFollowUpReference('combien coûte GitHub Copilot ?')).toBe(false)
    expect(isFollowUpReference('quel est le meilleur STT gratuit ?')).toBe(
      false
    )
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

  it('extracts options from conditional offers without any question mark', () => {
    expect(
      extractPendingOffer(
        'Si tu veux un lien vers une plateforme spécifique (Spotify, YouTube, TikTok…), ou si tu cherches un morceau en particulier, dis-moi tout !'
      )?.options
    ).toEqual(['Spotify', 'YouTube', 'TikTok'])
    expect(
      extractPendingOffer('Tu veux un exemple ou un script !')?.options
    ).toHaveLength(2)
    // Single implicit offer → signal found, but no separable options.
    const single = extractPendingOffer('Si tu veux plus de détails, dis-moi !')
    expect(single).not.toBeNull()
    expect(single?.options).toEqual([])
    // No offer signal at all.
    expect(extractPendingOffer('J\u2019adore Python !')).toBeNull()
    expect(extractPendingOffer('Voici Whisper, Vosk et Moonshine.')).toBeNull()
  })

  it('emits no layer for greetings and first turns', () => {
    expect(
      buildConversationStateLayer(
        trackConversationState(turns(['user', 'bonjour']))
      )
    ).toBe('')
    expect(buildConversationStateLayer(trackConversationState([]))).toBe('')
    // Cold bare confirmation with zero history: nothing to steer yet.
    expect(
      buildConversationStateLayer(trackConversationState(turns(['user', 'ok'])))
    ).toBe('')
  })

  it('BONJOUR → greeting → OUI never greets again (greeting relapse)', () => {
    const greeting =
      'Bonjour ! 👋 Ravi de vous voir — une question, un projet ou simplement une envie de discuter ? Je vous écoute.'
    const state = trackConversationState(
      turns(
        ['user', 'BONJOUR'],
        ['assistant', greeting],
        ['user', 'OUI']
      )
    )
    expect(state.lastUserIntent).toBe('confirmation')
    expect(state.activeTopic).toBe('')
    expect(state.hasAssistantMessage).toBe(true)
    expect(state.lastAssistantWasGreeting).toBe(true)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('Do NOT greet again')
    expect(layer).toContain('ONE short sentence inviting their actual request')
    // "Ravi de vous voir" may only appear inside the do-NOT list.
    expect(layer).toContain('no "Ravi de vous voir"')

    const hint = buildAffirmativeHint({
      userReply: 'OUI',
      lastAssistantText: greeting.slice(0, 180),
      state
    })
    expect(hint).toContain('Do NOT greet again')
    expect(hint).not.toContain('Continue THAT exact topic')
  })

  it('CODE DE PYTHON at turn 3 answers directly without any greeting', () => {
    const state = trackConversationState(
      turns(
        ['user', 'BONJOUR'],
        ['assistant', 'Bonjour ! 👋 Ravi de vous voir — une question ?'],
        ['user', 'OUI'],
        ['assistant', 'Salut ! 👋 Ravi de vous voir — je suis tout à l\u2019écoute.'],
        ['user', 'CODE DE PYTHON']
      )
    )
    expect(state.lastUserIntent).toBe('new_request')
    expect(state.activeTopic).toBe('CODE DE PYTHON')
    expect(state.hasAssistantMessage).toBe(true)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('NOT the first exchange')
    expect(layer).toContain('Do NOT open with a greeting')
    expect(layer).toContain('Answer it directly')
  })

  it('invites the request for bare confirmations even after a non-greeting assistant message', () => {
    const state = trackConversationState(
      turns(
        ['user', 'BONJOUR'],
        ['assistant', 'De quoi voulez-vous parler ?'],
        ['user', 'oui']
      )
    )
    expect(state.lastAssistantWasGreeting).toBe(false)
    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('Do NOT greet again')
    expect(layer).toContain('ONE short sentence inviting their actual request')
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

  it('filters previous options on "et sans Python ?" without switching topic', () => {
    const state = trackConversationState(
      turns(
        ['user', 'recherche l\u2019open free'],
        ['assistant', ASSISTANT_OPEN_1],
        ['user', 'et sans Python ?']
      )
    )
    expect(state.lastUserIntent).toBe('followup')
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)
    expect(state.pendingClarification).toBe(false)
  })

  it('links "et le TTS ?" to the ongoing voice context', () => {
    const state = trackConversationState(
      turns(
        ['user', 'recherche l\u2019open free'],
        ['assistant', ASSISTANT_OPEN_1],
        ['user', 'et le TTS ?']
      )
    )
    expect(state.lastUserIntent).toBe('followup')
    expect(state.activeTopic.toLowerCase()).toMatch(/open|free/)
    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('recherche l')
  })

  it('asks which option on "oui" after "Azure ou Open Source ?"', () => {    const state = trackConversationState(
      turns(
        ['user', 'je cherche un STT'],
        ['assistant', 'Tu préfères Azure ou Open Source ?'],
        ['user', 'oui']
      )
    )
    expect(state.lastUserIntent).toBe('confirmation')
    expect(state.pendingClarification).toBe(true)
    expect(state.offeredOptions).toHaveLength(2)
    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('ONE concise clarification question')
    expect(layer).toContain('Do NOT choose a branch yourself')
  })

  it('Tilsal150: "oui" on a conditional offer clarifies instead of echoing', () => {
    const assistantBio = [
      'Tilsal150 est un artiste montant de la scène urbaine, connu pour ses flows mélodiques.',
      'Si tu veux un lien vers une plateforme spécifique (Spotify, YouTube, TikTok…), ou si tu cherches un morceau en particulier, dis-moi tout !'
    ].join('\n')
    const state = trackConversationState(
      turns(
        ['user', 'Recherche-moi Tilsal150'],
        ['assistant', assistantBio],
        ['user', 'Oui']
      )
    )
    // RULE 1 — continuity: the explicit topic is preserved.
    expect(state.activeTopic.toLowerCase()).toContain('tilsal150')
    expect(state.lastUserIntent).toBe('confirmation')
    // RULE 2 — ambiguity: the conditional offer holds separable options.
    expect(state.offeredOptions).toEqual(
      expect.arrayContaining(['Spotify', 'YouTube', 'TikTok'])
    )
    expect(state.pendingClarification).toBe(true)

    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('ONE concise clarification question')
    expect(layer).toContain('Do NOT choose a branch yourself')
    expect(layer).toContain('Spotify')

    const hint = buildAffirmativeHint({
      userReply: 'Oui',
      lastAssistantText: assistantBio.slice(-180),
      state
    })
    expect(hint).toContain('ONE concise clarification question')
  })

  it('drops the old topic cleanly on a voluntary switch (GitHub Copilot)', () => {
    const state = trackConversationState(
      turns(
        ['user', 'recherche l\u2019open source STT'],
        ['assistant', ASSISTANT_OPEN_1],
        ['user', 'ok'],
        ['assistant', 'Parfait, dis-moi si tu veux un script.'],
        ['user', 'combien coûte GitHub Copilot ?']
      )
    )
    expect(state.lastUserIntent).toBe('new_request')
    expect(state.activeTopic.toLowerCase()).toContain('copilot')
    expect(state.previousTopic?.toLowerCase()).toMatch(/open|stt/)
    expect(state.pendingClarification).toBe(false)
    const layer = buildConversationStateLayer(state)
    expect(layer).toContain('NEW active topic')
    expect(layer).toContain('historical context only')
  })
})
