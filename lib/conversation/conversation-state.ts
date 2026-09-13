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
  /** What should happen next (deliver an offer, await a choice, …). */
  currentTask: string | null
  /** True when the last user message is ambiguous AND options are pending. */
  pendingClarification: boolean
  /** True when a short confirmation follows a multi-option assistant question. */
  ambiguousConfirmation: boolean
  lastUserIntent: LastUserIntent
  lastUserText: string
  /** Trailing open question of the last assistant message, if any. */
  lastAssistantQuestion: string | null
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

/** Short affirmative replies (FR/EN/MG): "oui", "ok", "d'accord", "vas-y", "continue", "eny", … */
const CONFIRMATION_RE =
  /^(ok|okay|oke|oké|oui|yes|yeah|yep|yup|sure|d'?accord|dac+|bien s[uû]r|parfait|avec plaisir|je veux bien|vas?-?y|vasy|continue?s?|allons?-?y|go|eny|marina)\b/

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
  return (
    !isShortConfirmation(q) && !isShortRejection(q) && !isGreetingLike(q)
  )
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
    .map(p => p.trim().replace(/^tu veux\s+/i, '').replace(/^voulez-vous\s+/i, ''))
    .filter(p => p.length >= 2)
  if (parts.length < 2) return []
  // Not a clean option list (e.g. a full sentence accidentally split).
  if (parts.some(p => p.length > MAX_OPTION_CHARS * 2)) return []
  return parts.map(p =>
    p.length > MAX_OPTION_CHARS ? `${p.slice(0, MAX_OPTION_CHARS - 1)}…` : p
  )
}

function collapse(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
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
  return clean.length <= MAX_QUOTE_CHARS ? clean : `${clean.slice(0, MAX_QUOTE_CHARS - 1)}…`
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
    currentTask: null,
    pendingClarification: false,
    ambiguousConfirmation: false,
    lastUserIntent: 'none',
    lastUserText: '',
    lastAssistantQuestion: null,
    offeredOptions: [],
    awaitingChoice: false,
    hasAssistantMessage: false,
    lastAssistantWasGreeting: false
  }
  if (!turns || turns.length === 0) return empty

  let activeTopic = ''
  let activeGoal = ''
  let previousTopic: string | null = null
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
        if (activeTopic) previousTopic = activeTopic
        activeTopic = toTopicLabel(text)
        activeGoal = toTopicLabel(text)
      }
    } else if (turn.role === 'assistant') {
      lastAssistantText = text
      hasAssistantMessage = true
    }
  }

  const lastAssistantQuestion = lastAssistantText
    ? extractTrailingQuestion(lastAssistantText)
    : null
  const offeredOptions = lastAssistantQuestion
    ? extractOfferedOptions(lastAssistantQuestion)
    : []
  const awaitingChoice = lastAssistantQuestion !== null
  const ambiguousConfirmation =
    lastUserIntent === 'confirmation' && offeredOptions.length >= 2

  let currentTask: string | null = null
  if (ambiguousConfirmation) {
    currentTask = `Disambiguate the pending choice: ${offeredOptions.map(o => `"${o}"`).join(' vs ')}`
  } else if (lastUserIntent === 'confirmation' && lastAssistantQuestion) {
    currentTask = `Deliver what was just offered ("${quote(lastAssistantQuestion)}") within the active topic`
  } else if (awaitingChoice && lastUserIntent !== 'confirmation') {
    currentTask =
      offeredOptions.length >= 2
        ? `Awaiting user decision: ${offeredOptions.map(o => `"${o}"`).join(' vs ')}`
        : `Open question awaiting the user: "${quote(lastAssistantQuestion ?? '')}"`
  }

  const lastAssistantWasGreeting = hasAssistantMessage
    ? isGreetingOpener(lastAssistantText)
    : false

  return {
    activeTopic,
    activeGoal,
    previousTopic,
    currentTask,
    pendingClarification: ambiguousConfirmation,
    ambiguousConfirmation,
    lastUserIntent,
    lastUserText,
    lastAssistantQuestion,
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

  // Greeting-relapse guard: a bare confirmation ("oui", "ok") answering the
  // assistant's own greeting — e.g. BONJOUR → greeting → OUI — carries NO
  // topic yet. The model must NOT greet a second time; it invites the actual
  // request in one short sentence.
  if (
    !state.activeTopic &&
    (state.lastUserIntent === 'confirmation' ||
      state.lastUserIntent === 'followup') &&
    state.hasAssistantMessage &&
    state.lastAssistantWasGreeting
  ) {
    return `<conversation_state>
The user just replied "${quote(state.lastUserText)}" with no established topic yet — a bare confirmation of your greeting, NOT a new greeting.
Do NOT greet again: no "Bonjour", "Salut", "Hello", "Coucou", no 👋, no self-introduction, no "Ravi de vous voir".
Reply with ONE short sentence inviting their actual request (a question, a project, or a topic), in the user's language.
</conversation_state>`
  }

  if (!state.activeTopic) return ''
  if (state.lastUserIntent === 'none' || state.lastUserIntent === 'greeting')
    return ''

  const historyNote = state.previousTopic
    ? `\nOlder context (do NOT return to it unprompted): "${quote(state.previousTopic)}".`
    : ''

  // Rule 2 — ambiguous short reply after a multi-option question: the model
  // must ask ONE concise clarification question, never pick a branch itself.
  if (state.ambiguousConfirmation && state.offeredOptions.length >= 2) {
    const options = state.offeredOptions.map(o => `"${o}"`).join(' vs ')
    return `<conversation_state>
Active topic: "${quote(state.activeTopic)}". User's current goal: "${quote(state.activeGoal)}".
The user just replied "${quote(state.lastUserText)}", but your previous message offered mutually exclusive options (${options}) without the user picking one.
Ask ONE concise clarification question naming these options, staying on the active topic above. Do NOT choose a branch yourself and do NOT switch back to an older topic.${historyNote}
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
Continue the active topic immediately. Do NOT switch back to an older topic merely because you previously proposed it. Do NOT repeat previous explanations unless asked.${historyNote}
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
Answer the new request directly; do not re-explain or re-ask about the old topic.
</conversation_state>`
  }

  return ''
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
