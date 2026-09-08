/**
 * UI icon validator for generated frontend code.
 *
 * Detects emojis that are used as UI icons inside generated code and flags them
 * as violations, while explicitly ALLOWING emojis that appear as real on-page
 * TEXT content.
 *
 * Scope (per the frontend-design skill rule):
 *   - CODE UI: emoji used as an icon glyph  -> FORBIDDEN (fail)
 *   - CODE TEXT: emoji inside <p>/<h1>/<span>/... copy -> ALLOWED (pass)
 *   - Conversational answer text (outside code) is NEVER analyzed.
 *
 * The parser only inspects HTML element content (and, lightly, CSS `content`
 * of icon selectors); a bare conversational line such as
 * "Voici votre design 🚀✨" contains no tags and is therefore never scanned.
 */

import type { Violation } from './validate'

const EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu

// A class name that signals the element is an icon container.
const ICON_CLASS_RE =
  /(^|\s|[-_])(icon|icons|feature-icon|featureicon|nav-icon|navicon|menu-icon|menuicon|action-icon|actionicon|status-icon|statusicon|icon-button|iconbutton|icon-wrapper|iconwrapper|iconbox|img-icon|ui-icon|badge-icon)(\s|$|[-_])/i

// role="img" or role="icon" means the element is a presentational icon.
const ICON_ROLE_RE = /^(img|icon)$/i

// Text-bearing elements: emoji inside them count as content, not icons.
const TEXT_ELEMENTS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'a',
  'li',
  'label',
  'td',
  'th',
  'blockquote',
  'strong',
  'em',
  'small',
  'figcaption',
  'dd',
  'dt',
  'caption',
  'option',
  'summary',
  'cite',
  'q',
  'mark',
  'time',
  'abbr',
  'dfn'
])

// Any letter or digit => the text node carries real (non-emoji) content.
const HAS_REAL_TEXT = /[\p{L}\p{N}]/u

interface UiEl {
  tag: string
  class: string
  role: string
  rawInner: string
  children: UiEl[]
}

function getAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? m[1] : ''
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/**
 * Build a lightweight element tree from an HTML snippet. Comments, <script> and
 * <style> bodies are removed first so emoji inside them never count. Self-closing
 * and mismatched tags are tolerated (best-effort) without throwing.
 */
function parseElements(html: string): UiEl[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  const root: UiEl[] = []
  const stack: UiEl[] = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(cleaned))) {
    if (m[4] !== undefined) {
      const parent = stack[stack.length - 1]
      if (parent) parent.rawInner += m[4]
      continue
    }

    const closing = m[1] === '/'
    const tag = (m[2] || '').toLowerCase()
    const attrs = m[3] || ''
    const full = m[0]

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }

    const el: UiEl = {
      tag,
      class: getAttr(attrs, 'class'),
      role: getAttr(attrs, 'role'),
      rawInner: '',
      children: []
    }

    const parent = stack[stack.length - 1]
    if (parent) {
      parent.children.push(el)
      parent.rawInner += full
    } else {
      root.push(el)
    }

    // Self-closing (e.g. <img .../>, <input/>) never contains text.
    if (!/\/\s*>$/.test(full)) stack.push(el)
  }

  return root
}

function evaluate(
  el: UiEl,
  ancestorHasText: boolean,
  violations: Violation[]
): void {
  const innerText = stripTags(el.rawInner)
  EMOJI_RE.lastIndex = 0
  const hasEmoji = EMOJI_RE.test(innerText)
  const elHasRealText = HAS_REAL_TEXT.test(innerText)
  const isIconContainer =
    ICON_CLASS_RE.test(el.class) || ICON_ROLE_RE.test(el.role)
  // Interactive / glyph elements: an emoji here is always a UI icon, even when
  // it sits next to a text label (e.g. <button>🚀 Launch</button>), which the
  // weak model produces a lot. The frontend-design skill forbids this.
  const isIconElement = isIconContainer || /^(button|a|i)$/i.test(el.tag)

  if (hasEmoji) {
    const inTextContext =
      elHasRealText || ancestorHasText || TEXT_ELEMENTS.has(el.tag)
    const isBareIcon = !elHasRealText && !ancestorHasText

    if (isIconElement || (isBareIcon && !inTextContext)) {
      violations.push({
        rule: 'ui.emoji-as-icon',
        severity: 'error',
        detail: `Emoji used as a UI icon in generated code (<${el.tag}${
          el.class ? ` class="${el.class}"` : ''
        }>). Replace it with a real icon (reuse an existing icon library, or use an inline <svg> / vector icon). Emoji stay allowed only as on-page TEXT content.`,
        snippet: innerText.trim().slice(0, 60)
      })
    }
  }

  const childAncestorHasText = ancestorHasText || elHasRealText
  for (const child of el.children)
    evaluate(child, childAncestorHasText, violations)
}

/**
 * Validate a generated HTML snippet for emoji-used-as-icon violations.
 * Only element content is inspected; conversational text is never passed here.
 */
export function validateUiIcons(html: string): Violation[] {
  const violations: Violation[] = []
  const tree = parseElements(html)
  for (const el of tree) evaluate(el, false, violations)
  return violations
}

/**
 * Light CSS check: flag `content: "…"` emoji glyphs inside icon-like selectors
 * (e.g. `.feature-icon::before { content: "⚡" }`). Kept narrow to avoid false
 * positives on legitimate textual `content` values.
 */
export function validateUiIconsCss(css: string): Violation[] {
  const violations: Violation[] = []
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null

  while ((m = ruleRe.exec(css))) {
    const selector = m[1] || ''
    const body = m[2] || ''
    // Icon glyphs appear in icon-class selectors, ::before/::after pseudo
    // elements (a common icon technique), or any selector mentioning "icon".
    if (
      !ICON_CLASS_RE.test(selector) &&
      !/::(before|after)/i.test(selector) &&
      !/\bicon\b/i.test(selector)
    )
      continue

    const contentMatch = body.match(/content\s*:\s*(["'])([^"']*)\1/i)
    if (!contentMatch) continue

    const value = contentMatch[2]
    EMOJI_RE.lastIndex = 0
    if (EMOJI_RE.test(value)) {
      violations.push({
        rule: 'ui.emoji-as-icon',
        severity: 'error',
        detail: `Emoji used as a UI icon in CSS (selector "${selector.trim()}"). Replace it with a real icon (inline <svg> or an icon library) instead of a CSS content glyph.`,
        snippet: body.trim().slice(0, 60)
      })
    }
  }

  return violations
}

/**
 * DETERMINISTIC FALLBACK — independent of the model's compliance.
 *
 * Removes every emoji that lives inside a generated fenced code block
 * (html / css / js / svg / ts / typescript). This guarantees the persisted
 * artifact contains NO emoji-used-as-UI-icon even when the weak model keeps
 * re-inserting them. Conversational text OUTSIDE code blocks is never touched,
 * so legitimate on-page prose emoji in chat replies are preserved.
 */
const CODE_BLOCK_RE =
  /```(html|css|js|javascript|ts|typescript|svg)\s*\n([\s\S]*?)```/gi

export function stripEmojisFromCodeBlocks(content: string): string {
  if (!content) return content
  return content.replace(CODE_BLOCK_RE, (_m, lang, code) => {
    const cleaned = code.replace(EMOJI_RE, '')
    return '```' + lang + '\n' + cleaned + '```'
  })
}
