/**
 * Unicode text folding for language-agnostic skill routing.
 *
 * Skills must work in EVERY user language, not just English/French. All
 * keyword matching (router triggers, intent regexes) runs on folded text so
 * accents/diacritics match with or without marks, matching is
 * case-insensitive, and non-Latin scripts (Arabic, Chinese, Cyrillic, ...)
 * survive tokenization instead of being stripped.
 *
 * Intent patterns and trigger lists are written in FOLDED form (lowercase,
 * no diacritics; non-Latin scripts as-is) and tested against
 * `foldText(query)`.
 */

/** Lowercase + strip diacritics + expand special ligatures. */
export function foldText(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u0305\u0307-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/\u00DF/g, 'ss')
    .replace(/\u00E6/g, 'ae')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0142/g, 'l')
    .replace(/\u0111/g, 'd')
    .replace(/\u00F8/g, 'o')
    .replace(/\u0451/g, '\u0435')
    .replace(/\u0131/g, 'i')
    // Recompose (NFC) so protected letters (Cyrillic short-I) return to
    // their canonical precomposed form for matching.
    .normalize('NFC')
}

/**
 * Unicode-aware word-boundary edges for intent regexes. `\b` only works for
 * Latin `[A-Za-z0-9_]` — it never matches inside Arabic/Chinese/Cyrillic
 * text. Use these instead: `(?:^|[^...])` prefix consumed, `(?![...])`
 * lookahead suffix.
 */
export const U_EDGE_BEFORE = '(?:^|[^\\p{L}\\p{N}_])'
export const U_EDGE_AFTER = '(?![\\p{L}\\p{N}_])'

/** Branches with these scripts match as substrings (no spaces/inflections). */
const SUBSTRING_SCRIPTS_RE = /[\u0590-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/u

/**
 * Split a regex alternation on TOP-LEVEL `|` only (ignores `|` inside
 * groups `(...)`, classes `[...]` and escaped `\|`), so branches carrying
 * their own groups — e.g. `edit\s+(this|my)\s+(photo|image)` — survive intact.
 */
function splitTopLevel(alternation: string): string[] {
  const out: string[] = []
  let depth = 0
  let inClass = false
  let current = ''
  for (let i = 0; i < alternation.length; i++) {
    const c = alternation[i]
    if (c === '\\') {
      current += c + (alternation[i + 1] ?? '')
      i++
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (!inClass && c === '(') depth++
    else if (!inClass && c === ')') depth = Math.max(0, depth - 1)
    if (c === '|' && depth === 0 && !inClass) {
      out.push(current)
      current = ''
      continue
    }
    current += c
  }
  out.push(current)
  return out
}

/**
 * Build a language-agnostic intent regex from a folded alternation.
 * The pattern must already be folded (lowercase, no diacritics).
 *
 * Matching strategy per branch:
 * - Latin/Malagasy: strict Unicode edges (so "jeu" doesn't match "jeune",
 *   "doc" doesn't match "docker").
 * - Arabic/Chinese/Cyrillic: substring match (no spaces between words,
 *   attached prepositions and inflections make edges fail).
 */
export function intentRe(alternation: string): RegExp {
  const edged: string[] = []
  const sub: string[] = []
  for (const branch of splitTopLevel(alternation)) {
    if (!branch) continue
    if (SUBSTRING_SCRIPTS_RE.test(branch)) sub.push(branch)
    else edged.push(branch)
  }
  const parts: string[] = []
  if (edged.length) {
    parts.push(`${U_EDGE_BEFORE}(?:${edged.join('|')})${U_EDGE_AFTER}`)
  }
  if (sub.length) {
    parts.push(`(?:${sub.join('|')})`)
  }
  return new RegExp(parts.join('|'), 'u')
}
