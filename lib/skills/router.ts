import type { SkillMeta, SkillSelection } from './types'

/** Hard caps to protect the model context (progressive disclosure). */
export const MAX_SKILLS = 5
export const MAX_REFS_PER_SKILL = 4
export const GLOBAL_MAX_REFS = 8
/** Minimum score for a skill to be considered relevant. */
const SCORE_THRESHOLD = 2

/**
 * Common words that must NOT drive routing. Many SKILL.md descriptions contain
 * words like "design" or "interface", so matching on them would select unrelated
 * skills. Routing therefore relies on the curated `triggers` and skill `name`.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'and', 'or', 'my',
  'your', 'this', 'that', 'is', 'are', 'be', 'build', 'create', 'make', 'write',
  'generate', 'produce', 'code', 'script', 'app', 'application', 'me', 'i',
  'you', 'it', 'as', 'at', 'by', 'from', 'into', 'using', 'use', 'to', 'an',
  'please', 'can', 'how', 'what', 'why', 'explain', 'show', 'get', 'set', 'new',
  'modern', 'premium', 'professional', 'complete', 'simple', 'small', 'good'
])

/** Lowercase, alphanumeric tokenization (keeps `+`, `#`, digits). */
export function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9+#]+/g) ?? []
}

/** Tokenize and drop stopwords / very short tokens. */
export function keywordTokens(value: string): Set<string> {
  return new Set(tokenize(value).filter(t => t.length > 1 && !STOPWORDS.has(t)))
}

/**
 * Extract "reference hints" from a SKILL.md body so the reference loader can use
 * the skill's OWN signal (its "Reference Guide" table + any inline
 * `references/*.md` mentions) to pick relevant references even when filename
 * token overlap with the query is weak.
 *
 * Returns a map of reference filename (e.g. `state-management.md`) → the
 * surrounding description text (the "Load When" column / mention context), which
 * is scored against the query tokens by the loader.
 */
export function extractReferenceHints(body: string): Map<string, string> {
  const hints = new Map<string, string>()

  // 1) Markdown table rows: `| Topic | references/foo.md | Load When text |`
  const tableRow =
    /\|\s*[^|]*\|\s*`?references\/([a-z0-9._-]+\.md)`?\s*\|\s*([^|]*)\|/gi
  for (const m of body.matchAll(tableRow)) {
    const file = m[1].toLowerCase()
    const desc = (hints.get(file) ?? '') + ' ' + m[2]
    hints.set(file, desc)
  }

  // 2) Any inline `references/<name>.md` mention, keyed with no extra description.
  const inline = /`?references\/([a-z0-9._-]+\.md)`?/gi
  for (const m of body.matchAll(inline)) {
    const file = m[1].toLowerCase()
    if (!hints.has(file)) hints.set(file, '')
  }

  return hints
}

/**
 * Intent keywords that signal a visual / frontend / UI task for which the
 * repository has no dedicated generic skill. When no specific skill matches,
 * we fall back to the closest real frontend expertise (react-expert, and
 * typescript-pro when TypeScript is implied) so the request still benefits
 * from specialized guidance instead of only the generic code-quality prompt.
 */
const VISUAL_KEYWORDS = [
  'svg',
  'html',
  'css',
  'ui',
  'interface',
  'dashboard',
  'landing',
  'frontend',
  'front-end',
  'webpage',
  'website',
  'design',
  'animation',
  'component',
  'visual',
  'responsive',
  'hero',
  'navbar',
  'nav',
  'page'
]

/** True when the query is a visual / frontend / UI task (for skill fallback). */
export function isVisualQuery(query: string): boolean {
  const tokens = keywordTokens(query)
  const normalized = query.toLowerCase()
  return VISUAL_KEYWORDS.some(k => {
    if (k.includes(' ') || k.includes('-')) {
      return normalized.includes(k)
    }
    return tokens.has(k)
  })
}

/**
 * Detect a coding / programming task so the router can fall back to a code
 * skill when no specific skill matched. Covers generic English ("write a
 * function", "refactor") and French ("écris du code", "crée une fonction")
 * phrasing. `code`/`script` are stopwords (filtered from tokens) so we also
 * test the raw normalized string.
 */
const CODE_KEYWORDS = [
  'code',
  'fonction',
  'function',
  'script',
  'class',
  'program',
  'programme',
  'algorithm',
  'debug',
  'bug',
  'refactor',
  'implement',
  'syntax',
  'compile',
  'compiler',
  'crée une fonction',
  'créer une fonction',
  'du code',
  'relis'
]
export function isCodeQuery(query: string): boolean {
  const tokens = keywordTokens(query)
  const normalized = query.toLowerCase()
  return CODE_KEYWORDS.some(k => {
    if (k.includes(' ') || k.includes('-')) {
      return normalized.includes(k)
    }
    return tokens.has(k)
  })
}

/**
 * Map a coding query to a dedicated language skill when the language is named
 * (so "code python" prefers python-pro over the generic code-reviewer).
 */
const CODE_LANG_MAP: Record<string, string> = {
  python: 'python-pro',
  typescript: 'typescript-pro',
  ts: 'typescript-pro',
  javascript: 'javascript-pro',
  js: 'javascript-pro',
  react: 'react-expert',
  vue: 'vue-expert',
  java: 'java-architect',
  go: 'golang-pro',
  golang: 'golang-pro',
  rust: 'rust-engineer',
  cpp: 'cpp-pro',
  'c++': 'cpp-pro',
  csharp: 'csharp-developer',
  sql: 'sql-pro'
}

/**
 * Detect a follow-up / variation request such as "Make another version",
 * "Try a different style", "Refais le hero", "Make it more futuristic".
 *
 * Used to keep the PREVIOUS turn's active skills alive instead of resetting to a
 * generic generation. A request that clearly switches domain (e.g. "write a
 * python script") is NOT treated as a follow-up, so the user's new intent wins.
 */
// Explicit VARIATION signals: the user wants a DIFFERENT visual direction while
// keeping the same domain/purpose. Distinct from MODIFY (small surgical change)
// and ADD (append a feature). Descriptive adjectives (premium/futuristic/minimal…)
// are intentionally EXCLUDED here — they are matched by VARIATION_PATTERN below so
// that "make it more futuristic" is a variation but "make the navbar minimal" is a
// MODIFY. `change`/`modify` are also excluded (they belong to MODIFY_KEYWORDS) so
// that "Change the colors" is treated as a surgical edit, not a redesign.
const VARIATION_ONLY_KEYWORDS = [
  'another',
  'version',
  'variant',
  'variation',
  'variations',
  'retry',
  'again',
  'different',
  'differently',
  'restyle',
  'redesign',
  'rework',
  'refais',
  'refaire',
  'autre',
  'différente',
  'différent',
  'nouvelle version',
  'version différente',
  'new style',
  'different style',
  'different design',
  'different look',
  'new direction',
  'one more',
  'more options',
  'alternative',
  'alt',
  'completely different'
]
const VARIATION_PATTERN =
  /\b(make|fais|render|turn|get|give|do|create|build|try)\b.+\b(more|less|different|another|new|redesigned|restyled)\b/i

// REBUILD signals: the user explicitly wants the whole thing thrown away and
// regenerated (still same domain/purpose, but a full rebuild is permitted).
const REBUILD_KEYWORDS = [
  'rebuild',
  're-build',
  'start over',
  'start from scratch',
  'from scratch',
  'regenerate everything',
  'recreate',
  'redo from scratch',
  'rebuild from scratch',
  'entirely new',
  'whole thing'
]

// ADD_TO_EXISTING signals: append a feature/section without touching the rest.
const ADD_KEYWORDS = [
  'add',
  'adds',
  'added',
  'adding',
  'ajoute',
  'ajouter',
  'ajoutes',
  'ajoutons',
  'include',
  'append',
  'insert',
  'incorporate'
]
const ADD_PATTERN = /\b(new|extra|another|more)\s+(section|page|part|block|module|area|row)\b/i

// MODIFY_EXISTING signals: a small, surgical change to existing code. This is the
// DEFAULT follow-up mode — when the user names a specific element/scope to change
// (color, button, navbar, hero, animation, responsive…) the previous code must be
// EDITED IN PLACE, never redesigned.
const MODIFY_KEYWORDS = [
  'change',
  'changes',
  'changed',
  'changing',
  'modify',
  'modifies',
  'modified',
  'fix',
  'fixes',
  'fixed',
  'adjust',
  'adjusts',
  'tweak',
  'tweaks',
  'improve',
  'improves',
  'update',
  'updates',
  'make it',
  'make the',
  'make this',
  'make them',
  'turn it',
  'turn the',
  'smaller',
  'bigger',
  'larger',
  'wider',
  'narrower',
  'taller',
  'shorter',
  'darker',
  'lighter',
  'brighter',
  'dimmer',
  'responsive',
  'mobile menu',
  'colour',
  'color',
  'colors',
  'colours',
  'theme',
  'toggle',
  'button',
  'navbar',
  'navigation',
  'hero',
  'animation',
  'layout'
]
const MODIFY_PATTERN = /\b(make|change|fix|adjust|update|improve|modify|turn|set)\b/i

// Requests that clearly move to a different domain must not inherit the previous skill.
const SWITCH_AWAY_PATTERN =
  /\b(python|java\b|sql\b|react|vue|api\b|server|backend|document|pdf|docx|xlsx|pptx|write (a|an) (script|function|class|component))\b/i

/**
 * Classify a follow-up user message for a previously generated frontend artifact.
 *
 * Returns one of:
 *  - 'MODIFY_EXISTING'  — surgical edit in place (e.g. "Make it dark", "Fix the button")
 *  - 'ADD_TO_EXISTING'  — extend without rebuilding (e.g. "Add a pricing section")
 *  - 'VARIATION_REQUEST'— same purpose, intentionally different visual direction
 *  - 'REBUILD_REQUEST'  — throw the previous code away and regenerate (same domain)
 *  - 'NEW_PROJECT'     — not a continuation of the previous artifact (returns null)
 *
 * The classification is used by `buildSkillContext` to choose the correct
 * continuity behavior: MODIFY/ADD/REBUILD preserve the existing code (no avoid-list,
 * no forced "new direction"), while VARIATION_REDDESIGN drives a genuine visual
 * redesign against a PREVIOUS-DESIGN AVOID-LIST.
 *
 * A request that clearly switches domain (SWITCH_AWAY_PATTERN) is never a follow-up.
 */
export type FollowUpIntent =
  | 'MODIFY_EXISTING'
  | 'ADD_TO_EXISTING'
  | 'VARIATION_REQUEST'
  | 'REBUILD_REQUEST'
  | 'NEW_PROJECT'

export function classifyFollowUpIntent(query: string): FollowUpIntent | null {
  const q = query.toLowerCase().trim()
  if (!q) return null
  if (SWITCH_AWAY_PATTERN.test(q)) return null

  if (ADD_KEYWORDS.some(k => q.includes(k)) || ADD_PATTERN.test(q)) {
    return 'ADD_TO_EXISTING'
  }
  if (REBUILD_KEYWORDS.some(k => q.includes(k))) {
    return 'REBUILD_REQUEST'
  }
  if (VARIATION_ONLY_KEYWORDS.some(k => q.includes(k)) || VARIATION_PATTERN.test(q)) {
    return 'VARIATION_REQUEST'
  }
  if (MODIFY_KEYWORDS.some(k => q.includes(k)) || MODIFY_PATTERN.test(q)) {
    return 'MODIFY_EXISTING'
  }
  // A very short message in a follow-up context is treated as a continuation
  // (edit in place — the safest default when the scope is unspecified).
  if (q.split(/\s+/).filter(Boolean).length <= 4) return 'MODIFY_EXISTING'
  return null
}

/** True when the query is a follow-up/continuation of a previous artifact. */
export function isFollowUpVariation(query: string): boolean {
  return classifyFollowUpIntent(query) != null
}

/** Score a single skill against the tokenized user query. */
function scoreSkill(
  skill: SkillMeta,
  query: string,
  queryTokens: Set<string>
): number {
  let score = 0

  // Trigger phrases (from real SKILL.md frontmatter) are the primary signal.
  for (const trigger of skill.triggers) {
    // Full multi-word phrase present as a substring.
    if (trigger.includes(' ') && query.includes(trigger)) {
      score += 3
      continue
    }
    // Every token of the trigger present in the query (handles "code review",
    // "design pattern", "server components", etc. written differently).
    const triggerTokens = keywordTokens(trigger)
    if (triggerTokens.size > 0) {
      let allPresent = true
      for (const t of triggerTokens) {
        if (!queryTokens.has(t)) {
          allPresent = false
          break
        }
      }
      if (allPresent) {
        score += trigger.includes(' ') ? 3 : 2
        continue
      }
    }
    // Single-token trigger matched exactly.
    if (!trigger.includes(' ')) {
      const single = trigger.replace(/[^a-z0-9+#]/g, '')
      if (single && queryTokens.has(single)) score += 2
    }
  }

  // Name tokens (e.g. "react" in "react-expert") are a strong signal.
  const nameTokens = keywordTokens(skill.name)
  for (const t of nameTokens) {
    if (queryTokens.has(t)) score += 2
  }

  // Fallback for skills that ship no `metadata.triggers` (the official Anthropic
  // Agent Skills expose only `name` + `description`). Score the description's
  // keyword tokens as a weak signal so a relevant skill still surfaces when its
  // name alone does not match. Capped so generic descriptions cannot dominate.
  if (skill.triggers.length === 0) {
    let descScore = 0
    for (const t of keywordTokens(skill.description)) {
      if (queryTokens.has(t)) descScore += 1
      if (descScore >= 3) break
    }
    score += descScore
  }

  return score
}

/**
 * Choose only the reference files relevant to this task. References are matched
 * by token overlap between the query and the reference filename stem, so a
 * "state management" request loads `state-management.md` but not `performance.md`.
 * If none match, no references are loaded (strict progressive disclosure) —
 * the SKILL.md body already carries a reference guide summary.
 */
function selectReferences(skill: SkillMeta, queryTokens: Set<string>): string[] {
  const scored = skill.references
    .map(ref => {
      const stem = ref.replace(/\.md$/, '').replace(/[-_]/g, ' ')
      let match = 0
      for (const t of keywordTokens(stem)) {
        if (queryTokens.has(t)) match += 1
      }
      return { ref, match }
    })
    .filter(r => r.match > 0)
    .sort((a, b) => b.match - a.match)
    .slice(0, MAX_REFS_PER_SKILL)
    .map(r => r.ref)

  return scored
}

/**
 * Skill Router: analyze the request and select the relevant skills (one or
 * many), then pick only the relevant references for each selected skill.
 *
 * This is the lightweight layer — it only ever reads the already-cached
 * frontmatter index, never the full skill bodies or reference files.
 */
export function routeSkills(
  query: string,
  registry: SkillMeta[],
  attachmentFormats?: string[],
  previousActiveSlugs?: string[]
): SkillSelection[] {
  const normalized = query.toLowerCase()
  const queryTokens = keywordTokens(query)

  const scored = registry
    .map(skill => ({
      skill,
      score: scoreSkill(skill, normalized, queryTokens)
    }))
    .filter(entry => entry.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  // Family de-duplication: drop a narrower skill variant (e.g. react-native-
  // expert) when a broader sibling (react-expert) is already selected and the
  // narrower skill's extra qualifier (e.g. "native") is NOT in the query.
  const deduped: { skill: SkillMeta; score: number }[] = []
  for (const cand of scored) {
    const cTokens = keywordTokens(cand.skill.name)
    const isNarrowerVariant = deduped.some(k => {
      const kTokens = keywordTokens(k.skill.name)
      const allKBroadInCandidate = [...kTokens].every(t => cTokens.has(t))
      if (!allKBroadInCandidate) return false
      const extra = [...cTokens].filter(t => !kTokens.has(t))
      return extra.length > 0 && extra.every(t => !queryTokens.has(t))
    })
    if (!isNarrowerVariant) deduped.push(cand)
  }

  const selections: SkillSelection[] = []
  let refBudget = GLOBAL_MAX_REFS

  for (const { skill, score } of deduped) {
    if (selections.length >= MAX_SKILLS) break
    if (selections.some(s => s.slug === skill.slug)) continue

    const refs = selectReferences(skill, queryTokens).slice(0, refBudget)
    refBudget -= refs.length

    selections.push({
      slug: skill.slug,
      name: skill.name,
      score,
      references: refs
    })

    if (refBudget <= 0) break
  }

  // Skill CONTINUITY: when this short follow-up is a variation/modification of a
  // previous turn, inherit that turn's active skills instead of resetting to a
  // generic generation. CURRENT USER INTENT still wins — a clear new-domain
  // request is excluded by isFollowUpVariation (SWITCH_AWAY_PATTERN) — and the
  // excludesReact block below can still drop an inherited skill on an override.
  const previous = previousActiveSlugs?.length ? previousActiveSlugs : []
  if (previous.length > 0 && isFollowUpVariation(query)) {
    for (const slug of previous) {
      if (selections.some(s => s.slug === slug)) continue
      if (selections.length >= MAX_SKILLS) break
      const skill = registry.find(s => s.slug === slug)
      if (!skill) continue
      const refs = selectReferences(skill, queryTokens).slice(0, refBudget)
      refBudget -= refs.length
      selections.push({
        slug: skill.slug,
        name: skill.name,
        score: SCORE_THRESHOLD,
        references: refs,
        inherited: true
      })
    }
  }

  // Honor explicit user exclusions such as "no React", "without framework",
  // "not React". A skill whose name/slug is explicitly rejected must never be
  // activated — this is the routing-level enforcement of USER REQUEST OVERRIDES
  // (the model is also told to follow the user's tech in the execution protocol).
  const excludesReact = /\b(no|without|not|never|avoid)\s+(react|react\.?js|framework)\b/i.test(
    query
  )
  if (excludesReact) {
    for (let i = selections.length - 1; i >= 0; i--) {
      if (/react/i.test(selections[i].slug) || /react/i.test(selections[i].name)) {
        selections.splice(i, 1)
      }
    }
  }

  // Visual / frontend / UI fallback: when nothing specific matched but the
  // request is clearly a visual task, route to the closest real frontend
  // expertise so the generation still receives specialized guidance.
  const isVisual = isVisualQuery(query)
  const wantsTs =
    normalized.includes('typescript') || normalized.includes('tsx')

  if (selections.length === 0 && isVisual) {
    // Route visual tasks to the dedicated visual-craft skill (SVG/HTML/CSS/UI)
    // instead of a framework-specific skill, plus TypeScript when implied.
    const fallbackSlugs = ['visual-craft']
    if (wantsTs) fallbackSlugs.push('typescript-pro')

    for (const slug of fallbackSlugs) {
      if (selections.length >= MAX_SKILLS) break
      const skill = registry.find(s => s.slug === slug)
      if (!skill) continue
      const refs = selectReferences(skill, queryTokens).slice(0, refBudget)
      refBudget -= refs.length
      selections.push({
        slug: skill.slug,
        name: skill.name,
        score: SCORE_THRESHOLD,
        references: refs
      })
    }
  }

  // Code fallback: when nothing matched but the request is clearly a coding
  // task, route to the dedicated language skill (when named) and/or the generic
  // code-reviewer so the generation receives concrete code best-practice
  // guidance instead of only a generic prose answer. Mirrors the visual fallback.
  const isCode = isCodeQuery(query)
  if (selections.length === 0 && isCode) {
    const codeSlugs: string[] = ['code-reviewer']
    for (const [tok, slug] of Object.entries(CODE_LANG_MAP)) {
      if (queryTokens.has(tok) || normalized.includes(tok)) {
        codeSlugs.unshift(slug)
        break
      }
    }
    for (const slug of codeSlugs) {
      if (selections.length >= MAX_SKILLS) break
      const skill = registry.find(s => s.slug === slug)
      if (!skill) continue
      const refs = selectReferences(skill, queryTokens).slice(0, refBudget)
      refBudget -= refs.length
      selections.push({
        slug: skill.slug,
        name: skill.name,
        score: SCORE_THRESHOLD,
        references: refs
      })
    }
  }

  // Attachment-driven routing: an uploaded document must activate its skill even
  // when the textual query has no matching trigger (the file content IS the
  // signal). Reuses the existing router — no second router is created.
  if (attachmentFormats && attachmentFormats.length > 0) {
    const fmtSet = new Set(
      attachmentFormats.map(f => f.toLowerCase().replace(/^\./, '').replace(/\.(docx|dotx|xlsx|xlsm|pptx|pdf)$/, '$1'))
    )
    for (const skill of registry) {
      if (selections.some(s => s.slug === skill.slug)) continue
      if (selections.length >= MAX_SKILLS) break
      if (fmtSet.has(skill.slug)) {
        const refs = selectReferences(skill, queryTokens).slice(0, refBudget)
        refBudget -= refs.length
        selections.push({
          slug: skill.slug,
          name: skill.name,
          score: SCORE_THRESHOLD,
          references: refs
        })
      }
    }
  }

  return selections
}
