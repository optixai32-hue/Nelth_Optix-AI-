import { describe, expect, it } from 'vitest'

import {
  validateCss,
  validateGeneratedOutput,
  validateHtml,
  validateResponsive
} from './validate'

describe('validate.ts — real programmatic validation', () => {
  it('FAILS on the exact reported invalid CSS: padding:block:var(--s8)', () => {
    const content = '```css\n.hero {\n  padding:block:var(--s8);\n}\n```'
    const r = validateGeneratedOutput(content)
    expect(r.passed).toBe(false)
    expect(r.violations.some(v => v.rule === 'css.invalid-property-colon')).toBe(true)
  })

  it('PASSES on the corrected CSS: padding-block:var(--s8)', () => {
    const content =
      '```css\n:root { --s8: 2rem; }\n.hero {\n  padding-block: var(--s8);\n}\n```'
    const r = validateGeneratedOutput(content)
    expect(r.passed).toBe(true)
  })

  it('FAILS when a var() references an undefined custom property', () => {
    const content = '```css\n.hero { color: var(--missing); }\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.rule === 'css.undefined-variable')).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('FAILS on broken HTML (mismatched / unclosed tags)', () => {
    const content = '```html\n<div><p>hello</div></p>\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.rule === 'html.mismatched-tag' || v.rule === 'html.unclosed-tag')).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('PASSES on well-formed HTML', () => {
    const content =
      '```html\n<!doctype html>\n<html lang="en"><head><title>t</title></head><body><div><p>hi</p></div></body></html>\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.severity === 'error')).toBe(false)
  })

  it('FAILS on invalid JavaScript syntax', () => {
    const content = '```js\nfunction f() { return })\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.rule === 'js.syntax-error')).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('FAILS on a generic hero/features/testimonial/cta/footer template with no direction', () => {
    const content =
      '```html\n<section class="hero"></section>\n<section class="features"></section>\n<section class="testimonial"></section>\n<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.rule === 'design.generic-template')).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('PASSES on a designed page that uses a palette (not generic)', () => {
    const content =
      '```html\n<section class="hero" style="background:#0b1f3a"></section>\n<section class="features"></section>\n<section class="testimonial"></section>\n<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content)
    expect(r.violations.some(v => v.rule === 'design.generic-template')).toBe(false)
  })

  it('validateCss directly flags a stray colon in a property', () => {
    expect(validateCss('.a { margin:top:1rem; }').some(v => v.rule === 'css.invalid-property-colon')).toBe(true)
  })

  it('validateHtml flags a missing alt on img', () => {
    expect(validateHtml('<img src="x.png">').some(v => v.rule === 'html.img-missing-alt')).toBe(true)
  })
})

describe('validate.ts — follow-up intent rules (spec §3/§4/§7)', () => {
  it('VARIATION warns when the previous font is reused verbatim (font diversity)', () => {
    const content =
      '```html\n<style>:root{--bg:#0b1f3a}.hero{font-family:Inter;color:var(--bg)}</style>\n' +
      '<section class="hero"></section>\n<section class="features"></section>\n' +
      '<section class="testimonial"></section>\n<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content, {
      slugs: ['frontend-design'],
      intent: 'VARIATION_REQUEST',
      previousDesignSummary: 'font(s): Inter; color(s): #3366ff'
    })
    expect(r.violations.some(v => v.rule === 'design.variation-copied-font')).toBe(true)
  })

  it('VARIATION does NOT warn when a different font is chosen', () => {
    const content =
      '```html\n<style>:root{--bg:#0b1f3a}.hero{font-family:Manrope;color:var(--bg)}</style>\n' +
      '<section class="hero"></section>\n<section class="features"></section>\n' +
      '<section class="testimonial"></section>\n<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content, {
      slugs: ['frontend-design'],
      intent: 'VARIATION_REQUEST',
      previousDesignSummary: 'font(s): Inter; color(s): #3366ff'
    })
    expect(r.violations.some(v => v.rule === 'design.variation-copied-font')).toBe(false)
  })

  it('MODIFY warns when the output is a fresh generic template instead of an edit', () => {
    const content =
      '```html\n<section class="hero"></section>\n<section class="features"></section>\n' +
      '<section class="testimonial"></section>\n<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content, {
      slugs: ['frontend-design'],
      intent: 'MODIFY_EXISTING',
      query: 'Make it dark'
    })
    expect(r.violations.some(v => v.rule === 'design.modify-became-rebuild')).toBe(true)
  })

  it('MODIFY does NOT warn on a designed, non-generic edit', () => {
    const content =
      '```html\n<section class="hero" style="background:#0b1f3a"></section>\n' +
      '<section class="features"></section>\n<section class="testimonial"></section>\n' +
      '<section class="cta"></section>\n<footer></footer>\n```'
    const r = validateGeneratedOutput(content, {
      slugs: ['frontend-design'],
      intent: 'MODIFY_EXISTING',
      query: 'Make it dark'
    })
    expect(r.violations.some(v => v.rule === 'design.modify-became-rebuild')).toBe(false)
  })

  describe('RESPONSIVE VALIDATION (FINAL QUALITY GATE)', () => {
    it('passes a responsive layout (viewport meta + grid + media query)', () => {
      const html =
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div class="wrap"></div></body></html>'
      const css =
        '.wrap { display: grid; grid-template-columns: 1fr; }\n@media (min-width: 768px) { .wrap { grid-template-columns: repeat(3, 1fr); } }'
      expect(validateResponsive(html, css)).toHaveLength(0)
    })

    it('passes a fluid layout using clamp()/vw', () => {
      const html =
        '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>'
      const css = 'h1 { font-size: clamp(2rem, 5vw, 4rem); }'
      expect(validateResponsive(html, css)).toHaveLength(0)
    })

    it('FAILS a fixed-width, desktop-only layout without viewport meta', () => {
      const html =
        '<!doctype html><html><head></head><body><div class="container"></div></body></html>'
      const css =
        '.container { width: 1200px; } .sidebar { width: 300px; } .main { width: 900px; }'
      const violations = validateResponsive(html, css)
      expect(violations.some(v => v.rule === 'design.not-responsive')).toBe(true)
      expect(violations[0].severity).toBe('error')
    })

    it('frontend-design output is rejected when not responsive', () => {
      const content =
        '```html\n<!doctype html><html><head></head><body><div class="container">x</div></body></html>\n```\n' +
        '```css\n.container { width: 1200px; } .a { width: 300px; } .b { width: 900px; }\n```'
      const r = validateGeneratedOutput(content, { slugs: ['frontend-design'] })
      expect(r.passed).toBe(false)
      expect(r.violations.some(v => v.rule === 'design.not-responsive')).toBe(true)
    })
  })
})
