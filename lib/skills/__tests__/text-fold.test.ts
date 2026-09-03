import { describe, expect, it } from 'vitest'

import { foldText, intentRe } from '@/lib/skills/text-fold'
import { keywordTokens } from '@/lib/skills/router'

describe('foldText', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldText('Bannière ÉCOLE')).toBe('banniere ecole')
    expect(foldText('Präsentation Straße')).toBe('prasentation strasse')
    expect(foldText('cœur')).toBe('coeur')
  })

  it('folds Arabic hamza forms together, leaves other scripts intact', () => {
    // U+0623 ALEF WITH HAMZA folds to plain alef, so both spellings match.
    expect(foldText('أريد لعبة')).toBe('اريد لعبة')
    expect(foldText('اريد لعبة')).toBe('اريد لعبة')
    expect(foldText('创建一个游戏')).toBe('创建一个游戏')
    expect(foldText('Создай Игру')).toBe('создай игру')
  })
})

describe('keywordTokens (Unicode)', () => {
  it('tokenizes accented words folded', () => {
    expect(keywordTokens('Crée un jeu')).toContain('jeu')
    expect(keywordTokens('Crée un jeu')).toContain('cree')
  })

  it('tokenizes Arabic, Chinese and Cyrillic', () => {
    expect(keywordTokens('أريد لعبة')).toContain('لعبة')
    expect(keywordTokens('创建一个游戏')).toContain('创建一个游戏')
    expect(keywordTokens('Создай игру')).toContain('игру')
  })
})

describe('intentRe (Unicode edges)', () => {
  it('matches inside Arabic/Chinese where \\b fails', () => {
    const re = intentRe('لعبة|游戏')
    expect(re.test('أريد لعبة جديدة')).toBe(true)
    expect(re.test('创建一个游戏')).toBe(true)
  })

  it('does not match partial Latin words', () => {
    const re = intentRe('jeu|game')
    expect(re.test('un jeu snake')).toBe(true)
    expect(re.test('jouets')).toBe(false)
    expect(re.test('gamer')).toBe(false)
  })

  it('matches plurals only when listed', () => {
    const re = intentRe('imagen|imagenes')
    expect(re.test('busca imagenes')).toBe(true)
  })
})
