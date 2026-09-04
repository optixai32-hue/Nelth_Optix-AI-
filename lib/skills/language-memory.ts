import { getTextFromParts } from '@/lib/utils/message-utils'

export type ConversationLanguage = 'mg' | 'fr' | 'en'

export type LanguageSource = 'requested' | 'detected'

export interface ResolvedLanguage {
  lang: ConversationLanguage
  source: LanguageSource
}

type AnyMessage = {
  role?: string
  parts?: unknown
  content?: unknown
}

/** Extract readable text from either a UIMessage (parts) or a ModelMessage (content). */
export function messageTextAny(message: AnyMessage | null | undefined): string {
  if (!message || typeof message !== 'object') return ''
  if (Array.isArray((message as { parts?: unknown }).parts)) {
    try {
      return getTextFromParts(
        (message as { parts?: never }).parts
      ).trim()
    } catch {
      return ''
    }
  }
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map(part =>
        part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : ''
      )
      .join(' ')
      .trim()
  }
  return ''
}

const MG_REQUEST_RE =
  /ataov\w*\s+(teny\s+)?malagasy|teny\s+malagasy|en\s+malagasy|traduit?\s+en\s+malagasy|malagasy\s+ve\b/i
const FR_REQUEST_RE = /en\s+fran[cç]ais|passe?\s+(au|en)\s+fran[cç]ais/i
const EN_REQUEST_RE = /in\s+english\b/i

/** Explicit language request in a single message ("ATAOVO TENY MALAGASY", "en français"...). */
export function findExplicitLanguageRequest(
  text: string | null | undefined
): ConversationLanguage | null {
  if (!text) return null
  if (MG_REQUEST_RE.test(text)) return 'mg'
  if (FR_REQUEST_RE.test(text)) return 'fr'
  if (EN_REQUEST_RE.test(text)) return 'en'
  return null
}

const norm = (text: string): string =>
  ` ${text
    .toLowerCase()
    .split(/[^a-zàâäéèêëîïôöùûüçñ]+/i)
    .filter(Boolean)
    .join(' ')} `

const escRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function countHits(folded: string, words: string[]): number {
  let n = 0
  for (const w of words) {
    // Word boundaries everywhere: substring matching would fire inside
    // unrelated words ('est' in 'best', 'les' in 'apples').
    if (new RegExp(`\\b${escRe(w)}\\b`).test(folded)) n++
  }
  return n
}

// Short but distinctive function words included ONLY when they cannot fire
// in the other covered languages (no 'dia' — Spanish 'día'; no 'en/un/le').
const MG_MARKERS = [
  'teny',
  'malagasy',
  'ahoana',
  'inona',
  'nahoana',
  'azafady',
  'misaotra',
  'ataovy',
  'amboary',
  'hazavao',
  'azavao',
  'tohizo',
  'averneo',
  'salama',
  'izay',
  'ireo',
  'izaho',
  'ianao',
  'izy',
  'azy',
  've',
  'tonga',
  'ny',
  'sy',
  'tsy',
  'koa',
  'indray',
  'ihany',
  'avy',
  'efa',
  'mbola',
  'kely',
  'tsara',
  'vao',
  'daholo',
  'rehetra',
  'zavatra',
  'olona',
  'vaovao',
  'andro'
]
const FR_MARKERS = [
  'bonjour',
  'merci',
  'vous',
  'est',
  'les',
  'des',
  'une',
  'pour',
  'avec',
  'comment',
  'pourquoi',
  'parce',
  'faire',
  'question',
  'moi',
  'ce',
  'que',
  'qui',
  'pas',
  'plus',
  'dans',
  'sur',
  'nous',
  'mon',
  'ma',
  'son',
  'sa',
  'quoi',
  'explique'
]
const EN_MARKERS = [
  'hello',
  'thanks',
  'the',
  'you',
  'what',
  'why',
  'please',
  'question',
  'about',
  'there',
  'explain',
  'how',
  'is'
]

/** Best-effort language guess for a single message. */
export function detectLanguage(
  text: string | null | undefined
): ConversationLanguage | 'unknown' {
  if (!text || !text.trim()) return 'unknown'
  // Malagasy-specific characters (o-circumflex, o-macron) are decisive.
  if (/[ôō]/.test(text.toLowerCase())) return 'mg'
  const folded = norm(text)
  const scores: Record<ConversationLanguage, number> = {
    mg: countHits(folded, MG_MARKERS),
    fr: countHits(folded, FR_MARKERS),
    en: countHits(folded, EN_MARKERS)
  }
  const best = (Object.keys(scores) as ConversationLanguage[]).sort(
    (a, b) => scores[b] - scores[a]
  )[0]
  if (scores[best] === 0) return 'unknown'
  if (
    (Object.keys(scores) as ConversationLanguage[]).filter(
      k => scores[k] === scores[best]
    ).length > 1
  ) {
    return 'unknown'
  }
  return best
}

/**
 * Resolve the ACTIVE conversation language:
 * 1. an explicit request in the CURRENT message wins (and becomes the new
 *    preference, since it is persisted into history),
 * 2. otherwise the most recent explicit request found in user history wins
 *    (the preference PERSISTS across turns),
 * 3. otherwise the detected language of the current message (Malagasy
 *    included — low-resource, the model must not default away from it),
 * 4. otherwise null (leave the default identity behavior alone).
 */
export function resolveConversationLanguage(
  history: AnyMessage[] | null | undefined,
  currentQuery: string | null | undefined
): ResolvedLanguage | null {
  const current = findExplicitLanguageRequest(currentQuery)
  if (current) return { lang: current, source: 'requested' }

  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i]
      if (!message || message.role !== 'user') continue
      const requested = findExplicitLanguageRequest(messageTextAny(message))
      if (requested) return { lang: requested, source: 'requested' }
    }
  }

  const detected = detectLanguage(currentQuery)
  if (detected !== 'unknown') return { lang: detected, source: 'detected' }
  return null
}

const LANGUAGE_NAMES: Record<ConversationLanguage, string> = {
  mg: 'Malagasy',
  fr: 'French',
  en: 'English'
}

/**
 * Builds the injected CONVERSATION LANGUAGE layer. Short by design — it is
 * prepended near the top of the system instructions on every turn that has
 * an active language.
 */
export function buildLanguageLayer(resolved: ResolvedLanguage | null): string {
  if (!resolved) return ''
  const name = LANGUAGE_NAMES[resolved.lang]
  return `CONVERSATION LANGUAGE — ${name} (ACTIVE${resolved.source === 'requested' ? ', user-requested' : ''}):
- Respond ENTIRELY in ${name} for this turn and KEEP ${name} until the user explicitly requests another language or a translation. Never ask which language to use.
- A language request about the previous answer ("ATAOVO TENY MALAGASY", "en français", "in English") means: rewrite/translate THAT previous content now — never restart with a greeting, never ask what to do.
- Short follow-ups continue the current task in ${name} (eny/tsia/ataovy/amboary/hazavao/continue/ary izao?/io/izay, oui/non/continue/et après ?, yes/no/continue/what about …): use the conversation history silently, answer directly.
- Technical terms (OAuth, API, GitHub, webhook, token, scope, endpoint, …) may stay in English when clearer.
`
}
