import { describe, expect, it } from 'vitest'

import { validateUiIcons } from './ui-icon-validator'
import { validateGeneratedOutput } from './validate'

const withSkill = (code: string) => validateGeneratedOutput(code, { slugs: ['frontend-design'] })

const hasIconViolation = (r: ReturnType<typeof validateGeneratedOutput>) =>
  r.violations.some(v => v.rule === 'ui.emoji-as-icon')

describe('ui-icon-validator — emoji as UI icon (frontend-design)', () => {
  it('TEST 1: FAIL — emoji inside an icon container', () => {
    const r = withSkill('```html\n<div class="feature-icon">⚡</div>\n```')
    expect(r.passed).toBe(false)
    expect(hasIconViolation(r)).toBe(true)
  })

  it('TEST 2: FAIL — emoji inside a bare button (icon button)', () => {
    const r = withSkill('```html\n<button>🔍</button>\n```')
    expect(hasIconViolation(r)).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('TEST 3: PASS — real <svg> icon in a button', () => {
    const r = withSkill(
      '```html\n<button aria-label="Search"><svg viewBox="0 0 24 24"></svg></button>\n```'
    )
    expect(hasIconViolation(r)).toBe(false)
    expect(r.passed).toBe(true)
  })

  it('TEST 4: PASS — emoji as on-page text content (<p>)', () => {
    const r = withSkill('```html\n<p>Bienvenue 👋</p>\n```')
    expect(hasIconViolation(r)).toBe(false)
    expect(r.passed).toBe(true)
  })

  it('TEST 5: PASS — emoji as on-page text content (<h1>)', () => {
    const r = withSkill('```html\n<h1>Construisez plus vite 🚀</h1>\n```')
    expect(hasIconViolation(r)).toBe(false)
    expect(r.passed).toBe(true)
  })

  it('TEST 6: PASS — conversational answer is never analyzed', () => {
    const r = withSkill('Voici votre design 🚀✨')
    expect(hasIconViolation(r)).toBe(false)
    expect(r.passed).toBe(true)
  })

  it('TEST 7: FAIL — multiple emoji feature icons', () => {
    const r = withSkill(
      '```html\n<div class="feature-icon">🎨</div>\n<div class="feature-icon">🔒</div>\n<div class="feature-icon">📱</div>\n```'
    )
    expect(hasIconViolation(r)).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('only runs when the frontend-design skill is active', () => {
    // Without the skill slug, emoji icons are intentionally NOT flagged here.
    const r = validateGeneratedOutput('```html\n<button>🔍</button>\n```')
    expect(hasIconViolation(r)).toBe(false)
  })

  it('direct validator: emoji-only span nested in text is treated as content', () => {
    const v = validateUiIcons('<p><span>🚀</span> Build faster</p>')
    expect(v.some(x => x.rule === 'ui.emoji-as-icon')).toBe(false)
  })
})
