/**
 * Real programmatic output validator for activated skills.
 *
 * This is the ENFORCEMENT layer: once a skill is active and the model has
 * generated a result, this module inspects the actual output (HTML / CSS / JS /
 * design quality / skill compliance) and reports concrete violations. It is NOT
 * a description of the skill — it is a checker that returns structured,
 * actionable problems so the refinement loop can FIX them before the result is
 * considered final.
 *
 * A skill is only "validated" when this returns `passed: true`. Detection,
 * loading and injection are separate concerns handled elsewhere.
 */

import { validateUiIcons, validateUiIconsCss } from './ui-icon-validator'

export type ViolationSeverity = 'error' | 'warning'

export interface Violation {
  /** Stable rule id, e.g. "css.invalid-declaration". */
  rule: string
  severity: ViolationSeverity
  /** Human-readable explanation of what is wrong. */
  detail: string
  /** Optional offending snippet for debugging. */
  snippet?: string
}

export interface ValidationResult {
  passed: boolean
  violations: Violation[]
  /** Short human summary used for debug output. */
  summary: string
}

export interface ValidateOptions {
  /** Active skill slugs (used for compliance checks). */
  slugs?: string[]
  /** Active skill bodies (SKILL.md content) for compliance checks. */
  bodies?: string[]
  /** The original user request (used to assess generic design). */
  query?: string
  /** Classified follow-up intent (MODIFY / ADD / VARIATION / REBUILD) when set. */
  intent?: string
  /** Previous-design AVOID-LIST text, used for variation font-diversity checks. */
  previousDesignSummary?: string
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

/**
 * Extract fenced code blocks from a markdown-ish response.
 * Returns the raw code per language tag (html / css / js / javascript / ts).
 */
export function extractCodeBlocks(
  content: string
): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = []
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const lang = (m[1] || '').toLowerCase()
    if (['html', 'css', 'js', 'javascript', 'ts', 'typescript'].includes(lang)) {
      blocks.push({ lang, code: m[2] })
    }
  }
  return blocks
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/**
 * Collect every custom property definition (`--name:`) declared anywhere in the
 * CSS, so we can detect `var(--x)` usages that are never defined.
 */
function collectDefinedVars(css: string): Set<string> {
  const defined = new Set<string>()
  const re = /(--[a-zA-Z0-9_-]+)\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) defined.add(m[1])
  return defined
}

function isUrlOrFunction(value: string): boolean {
  return /^(url|data|rgba?|hsla?|calc|var|linear-gradient|radial-gradient|conic-gradient|rgb|hsl)\(/i.test(
    value.trim()
  )
}

export function validateCss(css: string): Violation[] {
  const violations: Violation[] = []
  const defined = collectDefinedVars(css)

  // Split into rules. We only validate the declaration parts.
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g
  let rule: RegExpExecArray | null
  while ((rule = ruleRe.exec(css))) {
    const declarations = rule[2]
    const declList = declarations.split(';')
    for (const raw of declList) {
      const decl = raw.trim()
      if (!decl) continue

      const firstColon = decl.indexOf(':')
      if (firstColon < 0) {
        violations.push({
          rule: 'css.invalid-declaration',
          severity: 'error',
          detail: `CSS declaration has no property:value separator: "${decl}".`,
          snippet: decl
        })
        continue
      }

      const property = decl.slice(0, firstColon).trim()
      const value = decl.slice(firstColon + 1).trim()

      // A declaration whose VALUE still contains a ":" (and is not a url()/data
      // URI/color function) almost always means a hyphenated property was
      // written with ":" instead of "-", e.g. `padding:block:var(--s8)` which
      // should be `padding-block:var(--s8)`.
      if (
        value.includes(':') &&
        !isUrlOrFunction(value) &&
        !/^https?:\/\//.test(value)
      ) {
        violations.push({
          rule: 'css.invalid-property-colon',
          severity: 'error',
          detail: `Invalid CSS: "${decl}". This looks like a hyphenated property written with ":" (e.g. "padding:block:" should be "padding-block:").`,
          snippet: decl
        })
        continue
      }

      // Property names must be valid identifiers (letters, digits, -, _),
      // including CSS custom properties (--name). `--` is an optional prefix.
      if (!/^-{0,2}[a-zA-Z_][a-zA-Z0-9_-]*$/.test(property)) {
        violations.push({
          rule: 'css.invalid-property-name',
          severity: 'error',
          detail: `Invalid CSS property name: "${property}".`,
          snippet: decl
        })
        continue
      }

      // A bare `var(--x)` whose custom property is never defined.
      const varRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g
      let vm: RegExpExecArray | null
      while ((vm = varRe.exec(value))) {
        if (!defined.has(vm[1])) {
          violations.push({
            rule: 'css.undefined-variable',
            severity: 'error',
            detail: `CSS uses variable "${vm[1]}" which is never defined in the stylesheet.`,
            snippet: decl
          })
        }
      }

      // Length/angle values need a unit unless they are 0 or a keyword.
      const numUnit = value.match(/^([+-]?\d*\.?\d+)([a-z%]*)$/i)
      if (
        numUnit &&
        numUnit[2] === '' &&
        !/^(0|auto|inherit|initial|unset|none)$/i.test(value) &&
        !/^--/.test(property)
      ) {
        violations.push({
          rule: 'css.missing-unit',
          severity: 'warning',
          detail: `CSS value "${value}" for "${property}" is missing a unit (e.g. px, rem, %, em).`,
          snippet: decl
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export function validateHtml(html: string): Violation[] {
  const violations: Violation[] = []
  // Strip comments and doctype.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')

  const tagRe = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(cleaned))) {
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    const attrs = m[3] || ''
    const selfClosed = m[4] === '/'

    if (closing) {
      const top = stack.pop()
      if (top !== name) {
        violations.push({
          rule: 'html.mismatched-tag',
          severity: 'error',
          detail: `Mismatched tag: expected </${top}> but found </${name}>.`,
          snippet: `</${name}>`
        })
      }
      continue
    }
    if (name === 'img' && !/\balt\s*=/.test(attrs)) {
      violations.push({
        rule: 'html.img-missing-alt',
        severity: 'warning',
        detail: '<img> is missing an alt attribute (accessibility).'
      })
    }
    if (name === 'html' && !/\blang\s*=/.test(attrs)) {
      violations.push({
        rule: 'html.html-missing-lang',
        severity: 'warning',
        detail: '<html> is missing a lang attribute (accessibility).'
      })
    }

    if (VOID_ELEMENTS.has(name) || selfClosed) continue
    stack.push(name)
  }

  if (stack.length > 0) {
    violations.push({
      rule: 'html.unclosed-tag',
      severity: 'error',
      detail: `Unclosed tag(s): ${stack.join(', ')}.`
    })
  }

  return violations
}

// ---------------------------------------------------------------------------
// Responsive
// ---------------------------------------------------------------------------

/**
 * Check that a generated frontend interface is actually responsive. This is one
 * of the FINAL QUALITY GATE dimensions for the frontend-design skill.
 *
 * Conservative by design: it only fails when there is NO responsive signal AND
 * clear evidence of a fixed-width, desktop-only layout (multiple fixed px
 * widths, no viewport <meta>, no media queries, no fluid units, no grid/flex).
 * A design using clamp()/vw, grid/flex + viewport meta, or media queries passes.
 */
export function validateResponsive(
  html: string,
  css: string
): Violation[] {
  const violations: Violation[] = []
  const text = `${html}\n${css}`

  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)
  const hasMedia = /@media\s*\(/i.test(text)
  const hasFluid = /\bclamp\(|minmax\(|\bvw\b|\bvmin\b|\bvmax\b|\bvh\b/i.test(text)
  const hasGridFlex =
    /display\s*:\s*(grid|flex)|grid-template|flex-|\bflex\s*:/i.test(text)
  const hasMaxWidth = /max-width\s*:/i.test(text)

  const hasResponsiveSignal =
    hasMedia ||
    hasFluid ||
    (hasGridFlex && hasViewport) ||
    (hasViewport && hasMaxWidth) ||
    // a viewport meta plus any layout flex/grid is treated as responsive-intent
    (hasViewport && hasGridFlex)

  if (hasResponsiveSignal) return violations

  // No responsive signal: only flag when the layout is clearly fixed-width.
  const fixedWidthCount = (text.match(/width\s*:\s*\d{2,}px/gi) ?? []).length
  if (fixedWidthCount >= 3 && !hasViewport) {
    violations.push({
      rule: 'design.not-responsive',
      severity: 'error',
      detail:
        'Output does not appear responsive: no media queries, no fluid units (clamp/min/vw), no grid/flex with a viewport <meta>, and multiple fixed px widths without a viewport meta tag. Add a responsive layout (viewport <meta> + fluid units / grid / flex + media queries) so the design works on mobile.'
    })
  }
  return violations
}

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

export function validateJs(js: string): Violation[] {
  const violations: Violation[] = []
  // Strip import/export lines (not valid inside Function compile, but legal in
  // module sources) so we only check the executable body.
  const body = js
    .split('\n')
    .filter(l => !/^\s*(import\s|export\s|export\{|export\s+default)/.test(l))
    .join('\n')

  try {
    // Compiles (does not execute) — catches real syntax errors.
     
    new Function(body)
  } catch (e) {
    if (e instanceof SyntaxError) {
      violations.push({
        rule: 'js.syntax-error',
        severity: 'error',
        detail: `JavaScript syntax error: ${e.message}`
      })
    }
  }

  // Declared-but-undefined DOM references: addEventListener/handler targeting
  // an id that is never declared in the HTML (best-effort, only when HTML present).
  return violations
}

// ---------------------------------------------------------------------------
// Web-game validation (game-developer / canvas skills)
// ---------------------------------------------------------------------------

const GAME_INTENT_RE =
  /\b(game|video game|jeu|jeux|snake|tetris|pong|pac-?man|platformer|jouable|mini-?jeu)\b/i

/**
 * Validate a single-file web game (HTML + JS): loop, canvas, inputs,
 * self-containment. Only hard-fails on missing loop/canvas; softer
 * expectations (keyboard+touch, no hotlinked assets) are warnings so the
 * refinement loop improves them without blocking valid games.
 */
export function validateWebGame(html: string, js: string): Violation[] {
  const violations: Violation[] = []
  const combined = `${html}\n${js}`

  const hasCanvas = /<canvas[\s>]/i.test(html)
  const hasLoop =
    /requestAnimationFrame/i.test(combined) ||
    /setInterval\s*\(/.test(combined)

  if (html && !hasCanvas) {
    violations.push({
      rule: 'game.no-canvas',
      severity: 'error',
      detail:
        'Web game without a <canvas> element. Render the game on a canvas.'
    })
  }
  if (!hasLoop) {
    violations.push({
      rule: 'game.no-loop',
      severity: 'error',
      detail:
        'Web game without a game loop (no requestAnimationFrame / setInterval). Drive updates on requestAnimationFrame with delta-time.'
    })
  }

  const hasKeyboard = /key(down|up|press)/i.test(combined)
  const hasTouch = /touch(start|end|move)|pointer(down|move)/i.test(combined)
  if (!hasKeyboard && !hasTouch) {
    violations.push({
      rule: 'game.no-input',
      severity: 'warning',
      detail:
        'No keyboard or touch input detected. Support BOTH keyboard (arrows/WASD/space) and touch controls.'
    })
  }

  const externalAsset =
    /https?:\/\/[^\s'")<>]+\.(png|jpe?g|gif|webp|mp3|wav|ogg|mp4|woff2?)\b/i.exec(
      combined
    )
  if (externalAsset) {
    violations.push({
      rule: 'game.external-asset',
      severity: 'warning',
      detail: `Hotlinked asset (${externalAsset[0].slice(0, 80)}) — the game must be self-contained with zero network dependencies. Inline or synthesize assets instead.`
    })
  }

  return violations
}

// ---------------------------------------------------------------------------
// Generic / templated design detection
// ---------------------------------------------------------------------------

const GENERIC_SECTIONS = ['hero', 'feature', 'testimonial', 'cta', 'footer']

/**
 * Collect font-family names from a CSS/HTML/code snippet or a previous-design
 * AVOID-LIST string (e.g. "font(s): Inter, Manrope"). Used by the variation
 * font-diversity check to detect verbatim font reuse across versions.
 */
export function collectFontNames(text: string): string[] {
  if (!text) return []
  const fonts = new Set<string>()
  let m: RegExpExecArray | null
  const re = /font(?:-family)?[:=]\s*['"]?([^;'"}{]+)/gi
  while ((m = re.exec(text))) {
    const f = m[1]
      .split(',')[0]
      .replace(/^['"]|['"]$/g, '')
      .trim()
    if (f) fonts.add(f)
  }
  // AVOID-LIST format: "font(s): Inter, Manrope; color(s): …"
  const avoidRe = /font(?:\(s\))?:\s*([^;]+)/i
  const am = avoidRe.exec(text)
  if (am) {
    for (const f of am[1].split(',')) {
      const t = f.trim()
      if (t) fonts.add(t)
    }
  }
  return [...fonts]
}

/**
 * Flag a "template default" design: the output is structured ONLY as the generic
 * hero → features → testimonial → CTA → footer pattern with no concrete
 * aesthetic direction (named palette, typeface choice, subject-specific copy).
 */
export function detectGenericDesign(
  content: string,
  query?: string
): Violation[] {
  const violations: Violation[] = []
  const lower = content.toLowerCase()

  const genericHits = GENERIC_SECTIONS.filter(s => lower.includes(s)).length
  const hasDirection =
    /#[0-9a-f]{6}/i.test(content) || // explicit hex palette
    /\b(palette|typeface|font[- ]?pair|signature|eyebrow|aesthetic|art direction)\b/i.test(
      content
    ) ||
    /var\(--[a-z0-9_-]+\)/.test(content) // uses a designed token system

  if (genericHits >= 4 && !hasDirection) {
    violations.push({
      rule: 'design.generic-template',
      severity: 'error',
      detail:
        'Output follows the generic hero → features → testimonial → CTA → footer template with no concrete aesthetic direction (no named palette, typeface choice, or subject-specific treatment). This is exactly the templated default the active skill warns against.'
    })
  }

  return violations
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

/**
 * Validate a full model response (markdown + code) against the active skills.
 * Returns `passed: false` when any ERROR-severity violation is found, or when a
 * skill is active and the design is flagged as a generic template (warning that
 * we still surface; the enforcer decides whether to treat it as blocking).
 */
export function validateGeneratedOutput(
  content: string,
  opts: ValidateOptions = {}
): ValidationResult {
  const violations: Violation[] = []

  const blocks = extractCodeBlocks(content)
  let hasHtml = false
  let hasCss = false
  let hasJs = false
  let htmlContent = ''
  let cssContent = ''

  for (const b of blocks) {
    if (b.lang === 'html') {
      hasHtml = true
      htmlContent += b.code + '\n'
      violations.push(...validateHtml(b.code))
    } else if (b.lang === 'css') {
      hasCss = true
      cssContent += b.code + '\n'
      violations.push(...validateCss(b.code))
    } else if (['js', 'javascript', 'ts', 'typescript'].includes(b.lang)) {
      hasJs = true
      violations.push(...validateJs(b.code))
    }
  }

  // If no fenced blocks, try to validate the raw content heuristically.
  if (blocks.length === 0) {
    if (/<(!doctype|html|head|body|div|section|button)/i.test(content)) {
      hasHtml = true
      htmlContent += content + '\n'
      violations.push(...validateHtml(content))
    }
    if (/[.#]?[\w-]+\s*\{[^}]*:[^}]*\}/.test(content)) {
      hasCss = true
      cssContent += content + '\n'
      violations.push(...validateCss(content))
    }
  }

  if (hasHtml || hasCss) {
    violations.push(...detectGenericDesign(content, opts.query))
  }

  // Frontend-design skill: emoji are allowed as on-page TEXT content but must
  // never be used as UI icon glyphs in the generated code. This runs ONLY on the
  // extracted code (never on conversational text) and ONLY when the
  // frontend-design skill is active.
  if (opts.slugs?.includes('frontend-design')) {
    // RESPONSIVE VALIDATION — one of the FINAL QUALITY GATE dimensions.
    if (hasHtml || hasCss) {
      violations.push(...validateResponsive(htmlContent, cssContent))
    }

    for (const b of blocks) {
      if (b.lang === 'html') {
        violations.push(...validateUiIcons(b.code))
      } else if (b.lang === 'css') {
        violations.push(...validateUiIconsCss(b.code))
      }
    }
    // Heuristic fallback: a raw HTML snippet without fenced blocks.
    if (
      blocks.length === 0 &&
      /<(!doctype|html|head|body|div|section|button|span|nav|header|footer|main|article)/i.test(
        content
      )
    ) {
      violations.push(...validateUiIcons(content))
    }

    // VARIATION font diversity (spec §4 / §7 / TEST 7): a "make another version"
    // request must NOT simply reuse the previous design's font. When the previous
    // design fingerprint is available, flag a verbatim font reuse as a warning so
    // the refinement loop can pick a different type direction.
    if (opts.intent === 'VARIATION_REQUEST' && opts.previousDesignSummary) {
      const prevFonts = collectFontNames(opts.previousDesignSummary)
      const newFonts = collectFontNames(content)
      if (prevFonts.length > 0 && newFonts.length > 0) {
        const reused = newFonts.filter(f =>
          prevFonts.some(p => p.toLowerCase() === f.toLowerCase())
        )
        if (reused.length === newFonts.length) {
          violations.push({
            rule: 'design.variation-copied-font',
            severity: 'warning',
            detail: `Variation request but the same font(s) (${reused.join(
              ', '
            )}) as the previous design were reused. Choose a different type direction than the previous design.`
          })
        }
      }
    }

    // MODIFY / ADD must not silently become a full rebuild (spec §1 / §7 / §10).
    // A small-scope edit should preserve the previous structure; if the output
    // is a fresh generic default template, warn (the enforcer can re-prompt).
    if (
      (opts.intent === 'MODIFY_EXISTING' || opts.intent === 'ADD_TO_EXISTING') &&
      (hasHtml || hasCss)
    ) {
      const generic = detectGenericDesign(content, opts.query)
      if (generic.length > 0) {
        violations.push({
          rule: 'design.modify-became-rebuild',
          severity: 'warning',
          detail:
            'This was a modification/add request, but the output looks like a fresh generic hero→features→testimonial→cta→footer template instead of an edit of the existing code. Preserve the previous structure, sections and functionality; change ONLY the requested scope.'
        })
      }
    }
  }

  // Web-game validation: runs when a game skill is active, or when the query
  // itself asks for a game (both models go through the same gate). Canvas-only
  // generative art (canvas-design without game intent) only gets the
  // self-containment warning — a static rendering needs no game loop.
  const wantsGame =
    opts.slugs?.includes('game-developer') ||
    (opts.query ? GAME_INTENT_RE.test(opts.query) : false)
  if (wantsGame && (hasHtml || hasJs)) {
    const jsContent = blocks
      .filter(b => ['js', 'javascript', 'ts', 'typescript'].includes(b.lang))
      .map(b => b.code)
      .join('\n')
    violations.push(...validateWebGame(hasHtml ? htmlContent : content, jsContent))
  } else if (
    opts.slugs?.includes('canvas-design') &&
    (hasHtml || hasJs)
  ) {
    for (const v of validateWebGame(
      hasHtml ? htmlContent : content,
      blocks
        .filter(b => ['js', 'javascript', 'ts', 'typescript'].includes(b.lang))
        .map(b => b.code)
        .join('\n')
    )) {
      if (v.rule === 'game.external-asset') violations.push(v)
    }
  }

  const errors = violations.filter(v => v.severity === 'error')
  const passed = errors.length === 0

  const parts: string[] = []
  if (hasHtml) parts.push('HTML checked')
  if (hasCss) parts.push('CSS checked')
  if (hasJs) parts.push('JS checked')
  if (violations.length === 0) {
    parts.push('no violations')
  } else {
    parts.push(
      `${errors.length} error(s), ${violations.length - errors.length} warning(s)`
    )
  }

  return {
    passed,
    violations,
    summary: parts.join('; ')
  }
}
