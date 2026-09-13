/**
 * Conversation continuity state tracker (Nelth-IA).
 *
 * Fixes the "branch relapse" bug: after a topic switch (e.g. Azure STT →
 * free open-source STT), a short reply ("ok", "oui") made the model continue
 * the ASSISTANT's own previous question (back to Azure) instead of the USER's
 * latest explicit objective (open-source STT).
 *
 * The tracker is intentionally deterministic (no extra LLM call, no latency):
 * it derives a lightweight `ConversationState` from the message history —
 * active topic, user goal, pending open questions and ambiguous confirmations
 * — and renders a compact `<conversation_state>` directive block that the
 * orchestrators inject near the top of the system instructions.
 *
 * Priority order enforced by the rendered block:
 *   1. latest explicit user request
 *   2. immediate previous exchange
 *   3. current active topic
 *   4. relevant earlier context
 *   5. assistant's own previous suggestions (LOWEST)
 */

export interface ConversationTurnInput {
  role: string
  text: string
}

export type LastUserIntent =
  | 'new_request'
  | 'followup'
  | 'confirmation'
  | 'greeting'
  | 'none'

export interface ConversationState {
  /** Short label of the user's current objective (from their latest explicit request). */
  activeTopic: string
  /** What the user is trying to achieve right now. */
  activeGoal: string
  /** Topic replaced by the latest explicit request (historical context only). */
  previousTopic: string | null
  /** Past active topics, oldest-first (capped) — enables explicit returns. */
  previousTopics: string[]
  /** What should happen next (deliver an offer, await a choice, …). */
  currentTask: string | null
  /** True when the last user message is ambiguous AND options are pending. */
  pendingClarification: boolean
  /** True when a short confirmation follows a multi-option assistant question. */
  ambiguousConfirmation: boolean
  lastUserIntent: LastUserIntent
  lastUserText: string
  /** Cumulative user constraints still in force ("gratuit", "sans python"). */
  constraints: string[]
  /** Trailing open question of the last assistant message, if any. */
  lastAssistantQuestion: string | null
  /** Closing offer of the last assistant message, if any (may end with !/.). */
  lastAssistantOffer: string | null
  /** Mutually exclusive options detected in that question. */
  offeredOptions: string[]
  /** True when the assistant's last message ends with an open question. */
  awaitingChoice: boolean
  /** True when at least one assistant turn exists in the thread. */
  hasAssistantMessage: boolean
  /** True when the last assistant message was itself a greeting/opener. */
  lastAssistantWasGreeting: boolean
}

const MAX_TOPIC_CHARS = 160
const MAX_QUOTE_CHARS = 90
const MAX_QUESTION_CHARS = 300
const MAX_OPTION_CHARS = 90
const MAX_WORDS_SHORT_REPLY = 4
const MAX_WORDS_FOLLOWUP = 14

const WORDS = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** Lowercase + straighten quotes (mobile keyboards emit ’) + strip trailing punctuation. */
function normalizeReply(text: string): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[‘’‛′`]/g, "'")
    .replace(/[.!…]+$/, '')
}

/** Short affirmative replies (FR/EN/MG): "oui", "ok", "d'accord", "vas-y", "continue", "eny", "fais-le", "exact", … */
const CONFIRMATION_RE =
  /^(ok|okay|oke|oké|oui|yes|yeah|yep|yup|sure|yes please|d'?accord|dac+|bien s[uû]r|bien sur|bien|parfait|super|exact|c'est [cç]a|avec plaisir|je veux bien|fais-?le|fais (ça|ca|moi ça)|poursuis|encore|vas?-?y|vasy|continue?s?|allons?-?y|go|eny|marina)\b/

/** Short rejections: resolved against history, but they never change the topic. */
const REJECTION_RE = /^(non|no|nope|pas vraiment|tsy|tsia|non merci)\b/

/** Greetings / closings that carry no task intent. */
const GREETING_RE =
  /^(bonjour|bonsoir|salut|coucou|hello|hey|hi|yo|salama|merci|thanks|thank you|misaotra|à bientôt|a bientôt)\b/

/**
 * True continuations: conjunctions / prepositions that attach the message to
 * the ongoing thread ("et sans Python ?", "mais en local ?"). Question words
 * (combien, pourquoi, quel…) are DELIBERATELY excluded: with their own clause
 * ("combien coûte GitHub Copilot ?") the message is a self-contained request
 * and must be allowed to switch the topic.
 */
const CONTINUATION_OPENER_RE =
  /^(et(\s+(si|pour|sur|sans|avec|chez|dans|par|que))?|mais|ou|sans|avec|pour|sur|chez|dans|par|what about|how about|and|but|without|with|also)\b/

/**
 * Bare determiners ("le prix ?", "le plus rapide") attach to the thread only
 * for short messages or with a comparative. Longer Det-led messages
 * ("la météo demain") are treated as standalone requests.
 */
const DETERMINER_RE =
  /^(le|la|les|l'|un|une|des|du|de|d'|ce|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|the|a|an|this|that|these|those|my|your|its|their)\b/

/**
 * Question words only signal a follow-up when (almost) alone
 * ("pourquoi ?", "quel modèle ?"). Beyond 3 words the question carries its
 * own clause ("combien coûte GitHub Copilot ?") → standalone request.
 */
const SHORT_QUESTION_RE =
  /^(combien|pourquoi|comment|quel(le)?s?|lequel|laquelle|lesquel(le)?s|quoi|pour|why|how|what|which)\b/

/** Comparatives / superlatives compare within the current option set. */
const COMPARATIVE_RE =
  /\b(plus|moins|mieux|meilleur|meilleure|pire|premier|premiere|dernier|derniere|deuxieme|second|rapide|lent|cher|simple|facile|puissant|faster|slower|cheaper|best|fastest)\b/

/**
 * Anaphoric noun phrases that REQUIRE an antecedent in the thread
 * ("quel est le prix ?" = the price OF what we discuss). Deliberately narrow:
 * "quel est le meilleur STT gratuit ?" (new domain named) must NOT match, so
 * a voluntary topic switch is never swallowed.
 */
const ANAPHORIC_RE =
  /\b(c'est combien|combien ca|[cç]a coute|[cç]a marche|le prix|quel prix|la suite|la fin|what is the price|how much is it)\b/

/**
 * Bare "quel est le X ?" with NO domain noun after X ("quel est le prix ?",
 * "quel est le meilleur ?"). End-anchored on purpose: as soon as a domain is
 * named ("quel est le meilleur STT gratuit ?") the message is self-contained
 * and must be free to switch the topic.
 */
const ANAPHORIC_BARE_RE =
  /\b(quel est le (prix|tarif|cout|meilleur|pire|lien|resultat|nom)|quelle est la (difference|suite|meilleure)|quels sont les (prix|meilleurs))\s*\??$/

/** Deictic / ordinal references that point back to previous content. */
const REFERENCE_RE =
  /(ça|cela|celui|ceux|celle|celles|celui-ci|celui-là|le premier|le deuxième|le second|le 2|1er|2ème|2eme|#\d|this|that|these|those|the first|the second|the other one)\b/i

export function isShortConfirmation(text: string): boolean {
  const q = normalizeReply(text)
  if (!q || WORDS(q).length > MAX_WORDS_SHORT_REPLY) return false
  return CONFIRMATION_RE.test(q)
}

export function isShortRejection(text: string): boolean {
  const q = normalizeReply(text)
  if (!q || WORDS(q).length > MAX_WORDS_SHORT_REPLY) return false
  return REJECTION_RE.test(q)
}

export function isGreetingLike(text: string): boolean {
  const q = normalizeReply(text)
  if (!q || WORDS(q).length > MAX_WORDS_SHORT_REPLY) return false
  return GREETING_RE.test(q) && !CONFIRMATION_RE.test(q)
}

/**
 * Detects a short affirmative continuation ("oui", "ok", "d'accord"…) that
 * confirms the immediately preceding assistant offer/question. Moved here from
 * lib/agents/researcher.ts (re-exported there) so the streaming orchestrators
 * and this tracker share one definition without an import cycle.
 * Intentionally narrow: ≤3 words, affirmative opener, not a greeting.
 */
export function isAffirmativeContinuation(query: string): boolean {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return false
  if (q.split(/\s+/).filter(Boolean).length > 3) return false
  return /^(oui|non|ok|d'accord|daccord|bien s[uû]r|bien sur|parfait|merci|yes|no|yeah|okay|sure|bien sûr)\b/.test(
    q
  )
}

/**
 * Detects an assistant greeting / opener ("Bonjour ! 👋 Ravi de vous voir…",
 * "Salut ! …je suis là pour vous aider"). Used to catch the greeting-relapse:
 * a bare "oui"/"ok" answering a greeting must NEVER produce a second
 * greeting — there is no topic yet, only an invitation to state one.
 */
const ASSISTANT_GREETING_RE =
  /^(bonjour|bonsoir|salut|coucou|hello|hey|hi|yo|salama|bienvenue|👋|ravi(e)?\s+(de\s+(vous|te)\s+voir|de\s+faire\s+votre)|je\s+suis\s+nelth|enchant[eé])/i

export function isGreetingOpener(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return ASSISTANT_GREETING_RE.test(t)
}

export function isFollowUpReference(text: string): boolean {
  const q = (text ?? '').trim().toLowerCase()
  if (!q) return false
  const n = WORDS(q).length
  if (n > MAX_WORDS_FOLLOWUP) return false
  if (isShortConfirmation(text) || isGreetingLike(text)) return false
  if (REFERENCE_RE.test(q)) return true
  if (ANAPHORIC_RE.test(q) || ANAPHORIC_BARE_RE.test(q)) return true
  if (CONTINUATION_OPENER_RE.test(q)) return true
  if (SHORT_QUESTION_RE.test(q) && n <= 3) return true
  if (DETERMINER_RE.test(q) && (n <= 6 || COMPARATIVE_RE.test(q))) return true
  return false
}

export function isSubstantiveRequest(text: string): boolean {
  const q = (text ?? '').trim()
  if (!q) return false
  return !isShortConfirmation(q) && !isShortRejection(q) && !isGreetingLike(q)
}

/**
 * Returns the trailing open question of an assistant message (checks the last
 * two non-empty lines so a question followed by a one-line nudge is caught).
 */
export function extractTrailingQuestion(text: string): string | null {
  const lines = (text ?? '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/([^.!?…\n]{2,}\?)\s*$/)
    if (m) return m[1].trim().slice(0, MAX_QUESTION_CHARS)
    if (lines.length - 1 - i >= 1) break
  }
  return null
}

/**
 * Splits a question offering mutually exclusive branches
 * ("…pricing details ou une alternative open-source ?") into its options.
 * Returns [] for single yes/no questions or non-option text.
 */
export function extractOfferedOptions(question: string): string[] {
  if (!question || !question.trim().endsWith('?')) return []
  const core = question.trim().replace(/\?\s*$/, '')
  const parts = core
    .split(/\s+(?:ou|or)\s+|\s+vs\.?\s+|\s*\/\s*/i)
    .map(p =>
      p
        .trim()
        .replace(/^tu veux\s+/i, '')
        .replace(/^voulez-vous\s+/i, '')
    )
    .filter(p => p.length >= 2)
  if (parts.length < 2) return []
  // Not a clean option list (e.g. a full sentence accidentally split).
  if (parts.some(p => p.length > MAX_OPTION_CHARS * 2)) return []
  return parts.map(p =>
    p.length > MAX_OPTION_CHARS ? `${p.slice(0, MAX_OPTION_CHARS - 1)}…` : p
  )
}

/**
 * Offer signals in an assistant closing message: conditional offers
 * ("Si tu veux X ou Y, dis-moi"), capability offers ("Je peux te donner X
 * ou Y"), and direct questions ("Veux-tu X ou Y ?"). Exported for testing.
 */
const OFFER_SIGNAL_RE =
  /\b(si tu veux|si vous voulez|tu veux|vous voulez|dis-?moi si|dites-?moi si|je peux (te|vous)|veux-?tu|voulez-?vous|n'h[eé]site pas|dis-?moi tout|dites-?moi tout)\b/i

const OFFER_PREFIX_STRIP_RE =
  /^(si tu veux|si vous voulez|je peux (te|vous) (donner|proposer|chercher|trouver|faire|lister|montrer)|tu veux|vous voulez|veux-tu|voulez-vous|dis-moi si tu veux|dites-moi si vous voulez)\s+/i

function collapse(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Strips explicit topic-setter / correction prefixes so the active topic is
 * the entity itself, not the command sentence: "Recherche-moi Tilsal150" →
 * "Tilsal150", "Parlons de Whisper" → "Whisper", "Revenons à Azure" →
 * "Azure", "Non, je parle de Y" → "Y". Interrogative frames ("qui est…",
 * "quel est…") are deliberately KEPT — they carry meaning. Returns the
 * original text when nothing strips or stripping yields nothing.
 */
const TOPIC_SETTER_PREFIX_RE =
  /^(recherche(-moi)?|rechercher|cherche(-moi)?|chercher|trouve(-moi)?|trouver|find( me)?|search( for)?|look up|revenons (à|en)|retour (à|en)|retournons (à|en)|reparlons de|parlons de|parle-moi de|parlez-moi de|je parle de|non,?\s+je parle de|je veux dire|je voulais dire|non,?\s+je veux dire|dis-moi (tout sur|sur)|dites-moi (tout sur|sur))\s+/i

export function stripTopicSetterPrefix(text: string): string {
  const clean = collapse(text)
  if (!clean) return clean
  const stripped = clean.replace(TOPIC_SETTER_PREFIX_RE, '').trim()
  return stripped || clean
}

/** One-shot constraint signals detected in a user message (folded inside). */
const CONSTRAINT_FREE_RE = /\bgratuit|gratis|\bfree\b|open source|open-source/
const CONSTRAINT_FAST_RE = /\b(rapide|vite|vitesse|fast|speed)\b/
const CONSTRAINT_CHEAP_RE = /\b(pas cher|cheap|abordable|affordable)\b/
const CONSTRAINT_FRENCH_RE = /\bfran[çc]ais\b/
const CONSTRAINT_LOCAL_RE = /\b(local|hors ligne|offline)\b/
const CONSTRAINT_WITHOUT_RE = /\bsans\s+([a-zà-ÿ'’\- ]{1,30})/
const CONSTRAINT_WITH_RE = /\bavec\s+([a-zà-ÿ'’\- ]{1,30})/
/** Fillers that are NOT task constraints ("avec plaisir", "sans doute"). */
const CONSTRAINT_FILLER_RE =
  /^(plaisir|doute|blague|faute|souci|problemes?|questions?|plus|moins|mieux|toi|moi|lui|eux|nous|vous|ca|cela|sucre|sel)\b/

function foldConstraints(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Extracts cumulative user constraints (§11): "gratuit", "sans Python",
 * "rapide", "pas cher", "français", "local", "avec X". Canonical short
 * labels, order of appearance.
 */
export function extractConstraints(text: string): string[] {
  const q = foldConstraints(text)
  if (!q) return []
  const found: string[] = []
  if (CONSTRAINT_FREE_RE.test(q)) found.push('gratuit')
  if (CONSTRAINT_FAST_RE.test(q)) found.push('rapidité')
  if (CONSTRAINT_CHEAP_RE.test(q)) found.push('pas cher')
  if (CONSTRAINT_FRENCH_RE.test(q)) found.push('français')
  if (CONSTRAINT_LOCAL_RE.test(q)) found.push('local')
  const without = q.match(CONSTRAINT_WITHOUT_RE)
  if (without) {
    const x = without[1].trim().replace(/[?.!]+$/, '')
    if (x && !CONSTRAINT_FILLER_RE.test(x)) found.push(`sans ${x}`)
  }
  const withMatch = q.match(CONSTRAINT_WITH_RE)
  if (withMatch) {
    const x = withMatch[1].trim().replace(/[?.!]+$/, '')
    if (x && !CONSTRAINT_FILLER_RE.test(x)) found.push(`avec ${x}`)
  }
  return found
}

/**
 * Merges fresh constraint signals into the running set (§11–12): follow-ups
 * accumulate, a new explicit request restarts from its own markers, and
 * "avec X" replaces a conflicting "sans X" (never keep both).
 */
export function updateConstraints(
  prev: string[],
  text: string,
  intent: LastUserIntent
): string[] {
  const found = extractConstraints(text)
  let next = intent === 'new_request' ? [] : [...prev]
  for (const c of found) {
    if (c.startsWith('avec ')) {
      const base = c.slice(5).trim()
      next = next.filter(
        x => !(x.startsWith('sans ') && x.slice(5).trim() === base)
      )
      if (!next.includes(c)) next.push(c)
    } else if (c.startsWith('sans ')) {
      const base = c.slice(5).trim()
      next = next.filter(
        x => !(x.startsWith('avec ') && x.slice(5).trim() === base)
      )
      if (!next.includes(c)) next.push(c)
    } else if (!next.includes(c)) {
      next.push(c)
    }
  }
  return next.slice(-8)
}

/**
 * Closing segments of an assistant message (last two ?/!-terminated chunks,
 * plus a trailing period-terminated sentence when the tail lacks ?/!).
 * Multi-option offers live in the closing — never scan the whole message,
 * where an unrelated "ou" would create phantom options.
 */
function closingSegments(text: string): string[] {
  const chunks = (text ?? '')
    .split(/[?!\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const out = chunks.slice(-2)
  const tail = (text ?? '').trim()
  if (tail && !/[?!]$/.test(tail)) {
    const dotSegs = tail
      .split(/\.\s+(?=[A-ZÀ-Þ0-9«"“])/)
      .map(s => s.trim())
      .filter(Boolean)
    const lastDot = dotSegs[dotSegs.length - 1]?.replace(/\.\s*$/, '')
    if (lastDot && !out.includes(lastDot)) out.push(lastDot)
  }
  return out.slice(-2)
}

function cleanOption(p: string): string {
  const clean = p
    .trim()
    .replace(OFFER_PREFIX_STRIP_RE, '')
    .replace(/[….\s!?]+$/, '')
    .trim()
  return clean.length > MAX_OPTION_CHARS
    ? `${clean.slice(0, MAX_OPTION_CHARS - 1)}…`
    : clean
}

/**
 * Detects a pending multi-option OFFER in an assistant message even when it
 * is NOT phrased as a direct question — e.g. "Si tu veux un lien vers une
 * plateforme spécifique (Spotify, YouTube, TikTok…), ou si tu cherches un
 * morceau en particulier, dis-moi tout !". Returns the offer sentence plus
 * its options ([] when an offer signal exists but no separable options).
 * Returns null when there is no offer signal at all.
 */
export function extractPendingOffer(
  text: string
): { sentence: string; options: string[] } | null {
  const segs = closingSegments(text)
  if (segs.length === 0) return null
  const offerSeg =
    [...segs].reverse().find(s => OFFER_SIGNAL_RE.test(s)) ?? null
  if (!offerSeg) return null
  const sentence =
    offerSeg.length > MAX_QUESTION_CHARS
      ? `${offerSeg.slice(0, MAX_QUESTION_CHARS - 1)}…`
      : offerSeg

  // 1. Parenthetical enumeration: "(Spotify, YouTube, TikTok…)".
  const paren = offerSeg.match(/\(([^()]{2,160})\)/)
  if (paren) {
    const items = paren[1]
      .split(/[,;/]/)
      .map(s => s.trim().replace(/[….\s!?]+$/, ''))
      .filter(s => s.length >= 2)
    if (items.length >= 2) return { sentence, options: items.slice(0, 6) }
  }

  // 2. "ou"-separated branches — only on a short closing offer, never on a
  // long narrative paragraph where "ou" is incidental.
  if (offerSeg.length <= 280) {
    const parts = offerSeg
      .split(/\s+(?:ou|or)\s+|\s+vs\.?\s+|\s*\/\s*/i)
      .map(cleanOption)
      .filter(p => p.length >= 2)
    if (parts.length >= 2 && !parts.some(p => p.length > MAX_OPTION_CHARS * 2))
      return { sentence, options: parts }
  }

  return { sentence, options: [] }
}

function toTopicLabel(text: string): string {
  const clean = collapse(text)
  if (clean.length <= MAX_TOPIC_CHARS) return clean
  const cut = clean.slice(0, MAX_TOPIC_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : MAX_TOPIC_CHARS)}…`
}

function quote(text: string): string {
  const clean = collapse(text)
  return clean.length <= MAX_QUOTE_CHARS
    ? clean
    : `${clean.slice(0, MAX_QUOTE_CHARS - 1)}…`
}

function classifyUserMessage(text: string): Exclude<LastUserIntent, 'none'> {
  if (isGreetingLike(text)) return 'greeting'
  if (isShortConfirmation(text)) return 'confirmation'
  if (isShortRejection(text)) return 'followup'
  if (isFollowUpReference(text)) return 'followup'
  return 'new_request'
}

/**
 * Walks the thread chronologically. Only SUBSTANTIVE user requests move the
 * active topic — short confirmations, follow-ups and greetings never do, so
 * "ok" can never resurrect an older topic (the Azure relapse).
 */
export function trackConversationState(
  turns: ConversationTurnInput[]
): ConversationState {
  const empty: ConversationState = {
    activeTopic: '',
    activeGoal: '',
    previousTopic: null,
    previousTopics: [],
    currentTask: null,
    pendingClarification: false,
    ambiguousConfirmation: false,
    lastUserIntent: 'none',
    lastUserText: '',
    constraints: [],
    lastAssistantQuestion: null,
    lastAssistantOffer: null,
    offeredOptions: [],
    awaitingChoice: false,
    hasAssistantMessage: false,
    lastAssistantWasGreeting: false
  }
  if (!turns || turns.length === 0) return empty

  let activeTopic = ''
  let activeGoal = ''
  let previousTopic: string | null = null
  const previousTopics: string[] = []
  let constraints: string[] = []
  let lastUserIntent: LastUserIntent = 'none'
  let lastUserText = ''
  let lastAssistantText = ''
  let hasAssistantMessage = false

  for (const turn of turns) {
    const text = collapse(turn.text ?? '')
    if (!text) continue
    if (turn.role === 'user') {
      lastUserText = text
      const intent = classifyUserMessage(text)
      lastUserIntent = intent
      if (intent === 'new_request') {
        if (activeTopic) {
          previousTopic = activeTopic
          if (!previousTopics.includes(activeTopic)) {
            previousTopics.push(activeTopic)
            while (previousTopics.length > 5) previousTopics.shift()
          }
        }
        // The topic is the entity, not the command sentence.
        activeTopic = toTopicLabel(stripTopicSetterPrefix(text))
        activeGoal = toTopicLabel(text)
      } else if (intent === 'followup' && activeTopic) {
        // Goal refinement on the same topic ("Et son âge ?" → age of X).
        activeGoal = toTopicLabel(`${activeTopic} — ${text}`)
      }
      constraints = updateConstraints(constraints, text, intent)
    } else if (turn.role === 'assistant') {
      lastAssistantText = text
      hasAssistantMessage = true
    }
  }

  const lastAssistantQuestion = lastAssistantText
    ? extractTrailingQuestion(lastAssistantText)
    : null
  let offeredOptions = lastAssistantQuestion
    ? extractOfferedOptions(lastAssistantQuestion)
    : []
  // Offers phrased as conditionals ("Si tu veux X ou Y, dis-moi tout !")
  // carry options without any question mark — same ambiguity, same
  // clarification duty (Tilsal150 case).
  let lastAssistantOffer: string | null = null
  if (offeredOptions.length < 2 && lastAssistantText) {
    const offer = extractPendingOffer(lastAssistantText)
    if (offer) {
      lastAssistantOffer = offer.sentence
      if (offer.options.length >= 2) offeredOptions = offer.options
    }
  }
  const awaitingChoice =
    lastAssistantQuestion !== null || offeredOptions.length >= 2
  const ambiguousConfirmation =
    lastUserIntent === 'confirmation' && offeredOptions.length >= 2
  const offeredThing = lastAssistantQuestion ?? lastAssistantOffer

  let currentTask: string | null = null
  if (ambiguousConfirmation) {
    currentTask = `Disambiguate the pending choice: ${offeredOptions.map(o => `"${o}"`).join(' vs ')}`
  } else if (lastUserIntent === 'confirmation' && offeredThing) {
    currentTask = `Deliver what was just offered ("${quote(offeredThing)}") within the active topic`
  } else if (awaitingChoice && lastUserIntent !== 'confirmation') {
    currentTask =
      offeredOptions.length >= 2
        ? `Awaiting user decision: ${offeredOptions.map(o => `"${o}"`).join(' vs ')}`
        : `Open question awaiting the user: "${quote(offeredThing ?? '')}"`
  }

  const lastAssistantWasGreeting = hasAssistantMessage
    ? isGreetingOpener(lastAssistantText)
    : false

  return {
    activeTopic,
    activeGoal,
    previousTopic,
    previousTopics,
    currentTask,
    pendingClarification: ambiguousConfirmation,
    ambiguousConfirmation,
    lastUserIntent,
    lastUserText,
    constraints,
    lastAssistantQuestion,
    lastAssistantOffer,
    offeredOptions,
    awaitingChoice,
    hasAssistantMessage,
    lastAssistantWasGreeting
  }
}

/**
 * Renders the compact `<conversation_state>` directive block for the system
 * instructions. Returns '' when there is nothing worth steering (greetings,
 * first turn, plain new requests with no topic history).
 */
export function buildConversationStateLayer(state: ConversationState): string {
  if (!state) return ''

  const historyNote = state.previousTopic
    ? `\nOlder context (do NOT return to it unprompted): "${quote(state.previousTopic)}".`
    : ''
  const constraintsNote =
    state.constraints.length > 0
      ? `\nActive constraints (still in force, apply them): ${state.constraints.map(c => `"${c}"`).join(', ')}.`
      : ''

  // Greeting-relapse guard: a bare confirmation/follow-up with NO established
  // topic yet (e.g. BONJOUR → greeting → OUI) must NEVER produce another
  // greeting — it invites the actual request in one short sentence.
  if (
    !state.activeTopic &&
    (state.lastUserIntent === 'confirmation' ||
      state.lastUserIntent === 'followup') &&
    state.hasAssistantMessage
  ) {
    const ofGreeting = state.lastAssistantWasGreeting ? ' of your greeting' : ''
    return `<conversation_state>
The user just replied "${quote(state.lastUserText)}" with no established topic yet — a bare confirmation${ofGreeting}, NOT a new greeting.
Do NOT greet again: no "Bonjour", "Salut", "Hello", "Coucou", no 👋, no self-introduction, no "Ravi de vous voir".
Reply with ONE short sentence inviting their actual request (a question, a project, or a topic), in the user's language.
</conversation_state>`
  }

  // No-reset guard for the FIRST real topic once the thread started (e.g.
  // "CODE DE PYTHON" at turn 3, after greetings only): short requests
  // otherwise fall into the ≤3-word greeting exception and re-greet. Answer
  // directly instead. (A new_request always sets activeTopic, so the signal
  // here is the ABSENT previousTopic combined with existing history.)
  if (
    state.lastUserIntent === 'new_request' &&
    state.hasAssistantMessage &&
    !state.previousTopic
  ) {
    return `<conversation_state>
Ongoing conversation — this is NOT the first exchange. Do NOT open with a greeting ("Bonjour", "Salut", "Hello", "Coucou", 👋) and do NOT re-introduce yourself.
The user's latest request starts a NEW topic: "${quote(state.activeTopic)}". Answer it directly, in the user's language.${constraintsNote}
</conversation_state>`
  }

  if (!state.activeTopic) return ''
  if (state.lastUserIntent === 'none' || state.lastUserIntent === 'greeting')
    return ''

  // Rule 2 — ambiguous short reply after a multi-option question: the model
  // must ask ONE concise clarification question, never pick a branch itself.
  if (state.ambiguousConfirmation && state.offeredOptions.length >= 2) {
    const options = state.offeredOptions.map(o => `"${o}"`).join(' vs ')
    return `<conversation_state>
Active topic: "${quote(state.activeTopic)}". User's current goal: "${quote(state.activeGoal)}".
The user just replied "${quote(state.lastUserText)}", but your previous message offered mutually exclusive options (${options}) without the user picking one.
Ask ONE concise clarification question naming these options, staying on the active topic above. Do NOT choose a branch yourself and do NOT switch back to an older topic.${historyNote}${constraintsNote}
</conversation_state>`
  }

  // Rules 1/3/5 — short confirmation or follow-up: stay on the USER's active
  // objective, never on the assistant's own previous question.
  if (
    state.lastUserIntent === 'confirmation' ||
    state.lastUserIntent === 'followup'
  ) {
    const replyKind =
      state.lastUserIntent === 'confirmation'
        ? 'a short confirmation of the CURRENT objective below'
        : 'a follow-up — resolve pronouns, ordinals ("le deuxième") and implicit references against the CURRENT objective below'
    return `<conversation_state>
Active topic: "${quote(state.activeTopic)}". User's current goal: "${quote(state.activeGoal)}".
The user just replied "${quote(state.lastUserText)}" — ${replyKind}.
Continue the active topic immediately. Do NOT switch back to an older topic merely because you previously proposed it. Do NOT repeat previous explanations unless asked.${historyNote}${constraintsNote}
</conversation_state>`
  }

  // Rule 8 — explicit topic switch: the newest request wins, the old topic
  // becomes historical context only.
  if (
    state.lastUserIntent === 'new_request' &&
    state.previousTopic &&
    state.previousTopic !== state.activeTopic
  ) {
    return `<conversation_state>
The user's latest explicit request starts a NEW active topic: "${quote(state.activeTopic)}" (goal: "${quote(state.activeGoal)}").
"${quote(state.previousTopic)}" is now historical context only — do NOT return to it unless the user explicitly asks.
Answer the new request directly; do not re-explain or re-ask about the old topic.${constraintsNote}
</conversation_state>`
  }

  return ''
}

/**
 * Post-generation continuity guard (observability layer of the "final
 * protection"): checks a streamed answer against the deterministic
 * conversation state AFTER generation. The orchestrators log violations
 * ([ContinuityGuard]) so residual model failures are visible in production
 * traces instead of silent. Pure function — logging only, never blocks.
 */
export interface ContinuityViolation {
  rule: string
  detail: string
}

export function verifyResponseContinuity(
  response: string,
  state: ConversationState
): { ok: boolean; violations: ContinuityViolation[] } {
  const violations: ContinuityViolation[] = []
  const text = (response ?? '').trim()
  if (!text || !state) return { ok: true, violations }

  // A pending multi-option clarification MUST be answered with a question
  // naming the options — never an echo ("Tilsal150") or a blind pick.
  if (state.pendingClarification && state.offeredOptions.length >= 2) {
    if (!text.includes('?')) {
      violations.push({
        rule: 'clarification-must-ask',
        detail:
          'Ambiguous confirmation answered without asking the pending options.'
      })
    }
    const lowered = text.toLowerCase()
    const named = state.offeredOptions
      .slice(0, 4)
      .filter(o => o.length >= 3 && lowered.includes(o.toLowerCase()))
    if (named.length === 0) {
      violations.push({
        rule: 'clarification-must-name-options',
        detail: `None of [${state.offeredOptions.slice(0, 4).join(' | ')}] is named in the answer.`
      })
    }
  }

  // Any non-greeting turn with history must never open with a greeting.
  if (
    state.hasAssistantMessage &&
    state.lastUserIntent !== 'none' &&
    state.lastUserIntent !== 'greeting' &&
    isGreetingOpener(text)
  ) {
    violations.push({
      rule: 'no-greeting-reset',
      detail: 'Answer opens with a greeting mid-conversation.'
    })
  }

  return { ok: violations.length === 0, violations }
}

/**
 * Centralized affirmative-continuation hint builder shared by both streaming
 * orchestrators (authenticated + guest). Single source of truth so the two
 * paths can never drift apart again.
 *
 * @param userReply          latest user message text
 * @param lastAssistantText  first ~180 chars of the previous assistant message,
 *                           '' when it exists but has no text, null when there
 *                           is no assistant message at all
 * @param state              conversation state for this turn
 * @returns the hint string, or undefined when no hint applies
 */
export function buildAffirmativeHint(input: {
  userReply: string
  lastAssistantText: string | null
  state: ConversationState
}): string | undefined {
  const reply = (input.userReply ?? '').trim()
  const lastText = input.lastAssistantText
  const state = input.state
  if (!reply || lastText === null || !state) return undefined

  // Ambiguous multi-option confirmation → force ONE clarification question.
  // Runs BEFORE the affirmative gate on purpose: replies like "vas-y" or
  // "eny" are confirmations but not isAffirmativeContinuation() matches.
  if (state.pendingClarification && state.offeredOptions.length >= 2) {
    const options = state.offeredOptions.map(o => `"${o}"`).join(' vs ')
    return `The user just replied "${reply}" but your previous message offered mutually exclusive options (${options}) without the user picking one. Ask ONE concise clarification question naming these options, staying on the user's active topic ("${state.activeTopic}"). Do NOT choose a branch yourself and do NOT switch back to an older topic.`
  }

  if (!isAffirmativeContinuation(reply)) return undefined

  // No established topic yet (e.g. BONJOUR → greeting → OUI): inviting the
  // request — never greeting again, never "continuing" the greeting itself.
  if (!state.activeTopic) {
    return `The user just replied "${reply}" with no established topic yet. Do NOT greet again (no "Bonjour", "Salut", "Hello", 👋) and do NOT re-introduce yourself. Reply with ONE short sentence inviting their actual request (a question, a project, or a topic), in the user's language.`
  }

  return lastText
    ? `The user just replied "${reply}" confirming your previous message "${lastText}". Continue THAT exact topic immediately. Provide the content you offered.`
    : `The user just replied "${reply}" as a short affirmative continuation. Resolve it against the immediately preceding assistant message and continue that exact topic.`
}
