import { describe, expect, it } from 'vitest'

import { needsFactVerification } from '@/lib/conversation/factual-gate'

/**
 * Bug B (factual contradictions) — automatic tests for the verification gate.
 *
 * Pricing / quota / limit / trial / version questions MUST go through web
 * search (fresh results become the source of truth). Stable knowledge,
 * creative writing, greetings and identity questions MUST NOT pay the cost
 * of a forced search.
 */
describe('fact-verification gate', () => {
  it('forces verification for pricing questions', () => {
    for (const q of [
      'combien coûte GitHub Copilot ?',
      'azure stt free no limit',
      "c'est gratuit ?",
      'tarifs actuels',
      'quel est le prix par mois ?',
      'how much is whisper API?',
      'is there a free trial?'
    ])
      expect(needsFactVerification(q)).toBe(true)
  })

  it('forces verification for quotas, limits and trials', () => {
    for (const q of [
      'quelle est la limite mensuelle ?',
      'la limite ?',
      '5 heures par mois, c’est vrai ?',
      'quota dépassé ?',
      'offre gratuite vs plan pro',
      'version d’essai de 30 jours'
    ])
      expect(needsFactVerification(q)).toBe(true)
  })

  it('forces verification for versions and releases', () => {
    for (const q of [
      'dernière version de Whisper',
      'latest Gemini model version',
      'date de sortie de GPT-6',
      'changelog Next.js',
      'mise à jour iOS'
    ])
      expect(needsFactVerification(q)).toBe(true)
  })

  it('does not fire for stable knowledge, creative or casual turns', () => {
    for (const q of [
      'bonjour',
      'ok',
      'merci',
      'explique-moi la récursivité',
      'écris une histoire de pirate',
      'génère une image de chat',
      'donne une autre version',
      'limite le texte à 100 mots',
      'qui es-tu ?',
      'comment tu t’appelles ?'
    ])
      expect(needsFactVerification(q)).toBe(false)
  })

  it('never fires for internal identity subjects', () => {
    expect(needsFactVerification('qui est Nelth ?')).toBe(false)
    expect(needsFactVerification('montre le prix Optix AI')).toBe(false)
  })
})
