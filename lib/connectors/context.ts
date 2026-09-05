import { foldText, intentRe } from '@/lib/skills/text-fold'

import { ConnectorAuthError } from './api-client'
import {
  calendarList,
  driveRecent,
  driveSearch,
  githubRecentRepos,
  githubSearch,
  gmailSearch,
  notionSearch
} from './service-clients'
import { hasConnection } from './vault'

/**
 * Connector awareness for the chat model.
 *
 * - `detectConnectorIntent`: does this turn target the user's connected apps?
 * - `buildConnectorContext`: compact status block (who is connected, which
 *   tools to use, what to say when nothing is connected).
 * - `runConnectorPreload`: best-effort server-side fetch for models that
 *   cannot call tools (weak / preloaded path) — same data, injected as text.
 */

// Service-specific words in FOLDED form (lowercase, no accents — matched
// against foldText(query)). Strong signals that the user wants THEIR OWN
// data, not a web search.
const DATA_INTENT_RE = intentRe(
  'gmail|google\\s?mail|courriel|e-?mails?\\s?(?:recus?|envoyes?)?' +
    '|drive|google\\s?(?:doc|sheet|slide|disque)|fichier\\s?(?:drive|partage|recent)' +
    '|calendar|agenda|calendrier|rendez-?vous|reunions?(?:\\s?(?:a venir|prochain|demain|cette semaine))?' +
    '|github|depot|pull\\s?request|commit' +
    '|notion|page\\s?notion|base\\s?notion' +
    // Possessive + up to 2 filler words ("mes DERNIERS mails", "my LATEST
    // emails", "mon PROCHAIN agenda") — adjectives must not break detection.
    '|m(?:es|on|a)\\s+(?:\\S+\\s+){0,2}(?:mails?|e-?mails?|fichiers?|documents?|evenements?|reunions?|agenda|calendrier|drive|github|notion|repos?)' +
    '|my\\s+(?:\\S+\\s+){0,2}(?:mails?|e-?mails?|files?|documents?|events?|meetings?|repos?|agenda|calendar|drive|github|notion)' +
    '|boite(\\s+de)?\\s+(mail|reception)|inbox'
)

// "Is anything connected / how do I connect" — needs the status block but no
// data fetch and no tools. Folded form (e.g. "connectees", "connecteur").
const STATUS_INTENT_RE = intentRe(
  'connect(?:e+[sx]?|ed|eurs?|er)|integration|application\\s?connect|oauth' +
    '|quelles?\\s?(?:apps?|applications?|comptes?)\\s?(?:sont|est)\\s?connect' +
    '|mes\\s?connecteurs?'
)

/** True when this turn is about the user's connected apps. */
export function detectConnectorIntent(query: string): boolean {
  const folded = foldText(query ?? '')
  if (!folded.trim()) return false
  return DATA_INTENT_RE.test(folded) || STATUS_INTENT_RE.test(folded)
}

/** True when the user only asks about connection status (no data access). */
export function isStatusOnlyIntent(query: string): boolean {
  const folded = foldText(query ?? '')
  return STATUS_INTENT_RE.test(folded) && !DATA_INTENT_RE.test(folded)
}

// Plain literal words to drop when turning a user request into provider
// search keywords (matched against foldText output: lowercase, no accents).
const CONNECTOR_STOPWORDS = new Set(
  (
    'resume|resumer|cherche|chercher|retrouve|retrouver|trouve|trouver|montre|montrer|affiche|afficher|liste|lister|donne|donner|recupere|recuperer|vois|voir|lis|lire|envoie|envoyer' +
    '|summarize|summarise|summary|list|show|find|search|get|fetch|read|give' +
    '|mes|mon|ma|my' +
    '|mail|mails|email|emails|e-mail|e-mails|courriel|courriels|courrier|gmail|outlook|yahoo' +
    '|drive|fichier|fichiers|document|documents|doc|docs|dossier|dossiers' +
    '|agenda|calendrier|calendar|evenement|evenements|reunion|reunions|rendez-vous' +
    '|github|depot|depots|repo|repos|notion|page|pages' +
    '|dernier|derniers|derniere|dernieres|recent|recents|recente|recentes|nouveau|nouveaux|nouvelle|nouvelles|premier|premiers|premiere|premieres|prochain|prochains|prochaine|prochaines|latest|last|newest' +
    '|le|la|les|de|des|du|un|une|et|ou|the|a|an|of|from|for|with|about|avec|pour|sur|dans|stp|svp|moi|please'
  ).split('|')
)

/**
 * Turns "résume mes derniers mails" into "" (→ list recent) and "retrouve
 * le mail de facturation" into "facturation". The raw user sentence must
 * NEVER be sent as a provider query: command verbs and possessives match
 * nothing and yield empty preloads that make the model wrongly deny access.
 */
export function extractConnectorKeywords(query: string): string {
  const words = foldText(query ?? '')
    .replace(/[^a-z0-9_\s@.-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !CONNECTOR_STOPWORDS.has(w))
  return words.join(' ').slice(0, 120)
}

export interface ConnectorStatus {
  google: boolean
  github: boolean
  notion: boolean
}

export async function getConnectorStatus(
  userId: string
): Promise<ConnectorStatus> {
  if (!userId || userId === 'guest') {
    return { google: false, github: false, notion: false }
  }
  const [google, github, notion] = await Promise.all([
    hasConnection(userId, 'google').catch(() => false),
    hasConnection(userId, 'github').catch(() => false),
    hasConnection(userId, 'notion').catch(() => false)
  ])
  return { google, github, notion }
}

const TOOL_LINE =
  'Use the matching connector TOOL (never invent emails, files, events, repos or pages): gmail → Gmail, drive → Google Drive, calendar → Google Calendar, github → GitHub, notion → Notion.'

/**
 * Compact block injected near the top of the system instructions when the
 * turn targets connected apps.
 */
export async function buildConnectorContext(
  userId: string
): Promise<{ text: string; status: ConnectorStatus; anyConnected: boolean }> {
  const status = await getConnectorStatus(userId)
  const connected: string[] = []
  const missing: string[] = []
  if (status.google) connected.push('Google (Gmail, Drive, Calendar)')
  else missing.push('Google (Gmail, Drive, Calendar)')
  if (status.github) connected.push('GitHub')
  else missing.push('GitHub')
  if (status.notion) connected.push('Notion')
  else missing.push('Notion')

  const lines = ['CONNECTED APPS (user-owned accounts, read-only):']
  lines.push(
    connected.length > 0
      ? `- Connected: ${connected.join(' · ')}. ${TOOL_LINE}`
      : '- None connected yet.'
  )
  if (missing.length > 0) {
    lines.push(
      `- NOT connected: ${missing.join(' · ')}. If the user asks for data there, do NOT call any tool for it and do NOT claim to have read it — tell them briefly to open the "Connecter une application" card under the chat input and click Connect, then ask again.`
    )
  }
  lines.push(
    '- When a connector tool returns state "auth-required", tell the user to reconnect that app from the connector card and STOP — do not retry in a loop.',
    '- Cite what you actually found (subject / file name / date). If nothing was found, say so plainly.',
    '- Reading personal data never requires image generation: do NOT call generateImage for a connector request.'
  )
  return {
    text: lines.join('\n'),
    status,
    anyConnected: connected.length > 0
  }
}

const PRELOAD_BUDGET = 4000

function clipSection(header: string, body: string): string {
  const line = `${header}\n${body}`
  return line.length > 1200 ? line.slice(0, 1200) + '\n…[truncated]' : line
}

export type ConnectorPreloadService =
  | 'gmail'
  | 'drive'
  | 'calendar'
  | 'github'
  | 'notion'

export interface ConnectorPreloadCall {
  service: ConnectorPreloadService
  input: Record<string, unknown>
  output: {
    state: 'complete' | 'auth-required' | 'error'
    [key: string]: unknown
  }
}

export interface ConnectorPreloadResult {
  layer: string
  calls: ConnectorPreloadCall[]
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

function authRequiredOutput(provider: string) {
  return {
    state: 'auth-required' as const,
    provider,
    message: `The ${provider} connection expired or was revoked. Tell the user to reconnect it from the "Connecter une application" connector card.`
  }
}

/**
 * Best-effort fetch across every connected provider for models that cannot
 * call tools. Returns BOTH:
 * - `layer`: text injected like the preloaded web-search layer so the model
 *   answers from real data instead of denying access;
 * - `calls`: structured per-service results, surfaced by the streaming layer
 *   as synthetic `tool-gmail` / `tool-drive` / … parts so Nelth-3.5 renders
 *   the exact same activity shimmer + result sections as the Thinking model
 *   (same pattern as the synthetic `tool-search` for preloaded web search).
 *
 * Failures are silent per provider; an expired grant surfaces as a one-line
 * "reconnect" note instead of an error.
 */
export async function runConnectorPreloadStructured(
  userId: string,
  query: string,
  status: ConnectorStatus
): Promise<ConnectorPreloadResult> {
  const keywords = extractConnectorKeywords(query)
  const calls: ConnectorPreloadCall[] = []
  const sections: string[] = []

  type TaskResult = {
    call: ConnectorPreloadCall | null
    section: string | null
  }
  const tasks: Array<() => Promise<TaskResult>> = []

  if (status.google) {
    tasks.push(async () => {
      const input = { action: 'search', query: keywords, maxResults: 3 }
      const r = await settle(gmailSearch(userId, keywords, 3))
      if (!r.ok) {
        if (r.error instanceof ConnectorAuthError) {
          return {
            call: {
              service: 'gmail' as const,
              input,
              output: authRequiredOutput('Google')
            },
            section: 'GMAIL: reconnexion requise (connector card).'
          }
        }
        return { call: null, section: null }
      }
      if (r.value.items.length === 0) return { call: null, section: null }
      return {
        call: {
          service: 'gmail' as const,
          input,
          output: { state: 'complete' as const, items: r.value.items }
        },
        section: clipSection(
          'GMAIL RESULTS:',
          r.value.items
            .map(
              i => `- "${i.subject}" — ${i.from} (${i.date})\n  ${i.snippet}`
            )
            .join('\n')
        )
      }
    })
    tasks.push(async () => {
      // Empty keywords = "my recent stuff": list latest instead of matching.
      const input = { action: 'search', query: keywords || '(récents)' }
      const r = await settle(
        keywords ? driveSearch(userId, keywords, 5) : driveRecent(userId, 5)
      )
      if (!r.ok) {
        if (r.error instanceof ConnectorAuthError) {
          return {
            call: {
              service: 'drive' as const,
              input,
              output: authRequiredOutput('Google')
            },
            section: 'DRIVE: reconnexion requise (connector card).'
          }
        }
        return { call: null, section: null }
      }
      if (r.value.items.length === 0) return { call: null, section: null }
      return {
        call: {
          service: 'drive' as const,
          input,
          output: { state: 'complete' as const, items: r.value.items }
        },
        section: clipSection(
          'DRIVE RESULTS:',
          r.value.items.map(i => `- "${i.name}" (${i.mimeType})`).join('\n')
        )
      }
    })
    tasks.push(async () => {
      const input: Record<string, unknown> = {}
      const r = await settle(calendarList(userId))
      if (!r.ok) {
        if (r.error instanceof ConnectorAuthError) {
          return {
            call: {
              service: 'calendar' as const,
              input,
              output: authRequiredOutput('Google')
            },
            section: 'CALENDAR: reconnexion requise (connector card).'
          }
        }
        return { call: null, section: null }
      }
      if (r.value.items.length === 0) return { call: null, section: null }
      return {
        call: {
          service: 'calendar' as const,
          input,
          output: { state: 'complete' as const, items: r.value.items }
        },
        section: clipSection(
          'CALENDAR (next 7 days):',
          r.value.items.map(i => `- "${i.summary}" — ${i.start}`).join('\n')
        )
      }
    })
  }
  if (status.github) {
    tasks.push(async () => {
      const input = {
        action: 'search',
        query: keywords || '(récents)',
        kind: 'repositories'
      }
      const r = await settle(
        keywords
          ? githubSearch(userId, keywords, 'repositories')
          : githubRecentRepos(userId)
      )
      if (!r.ok) {
        if (r.error instanceof ConnectorAuthError) {
          return {
            call: {
              service: 'github' as const,
              input,
              output: authRequiredOutput('GitHub')
            },
            section: 'GITHUB: reconnexion requise (connector card).'
          }
        }
        return { call: null, section: null }
      }
      if (r.value.items.length === 0) return { call: null, section: null }
      return {
        call: {
          service: 'github' as const,
          input,
          output: { state: 'complete' as const, items: r.value.items }
        },
        section: clipSection(
          'GITHUB RESULTS:',
          r.value.items.map(i => `- ${i.title} (${i.url})`).join('\n')
        )
      }
    })
  }
  if (status.notion) {
    tasks.push(async () => {
      const input = { action: 'search', query: keywords || '(récents)' }
      const r = await settle(notionSearch(userId, keywords))
      if (!r.ok) {
        if (r.error instanceof ConnectorAuthError) {
          return {
            call: {
              service: 'notion' as const,
              input,
              output: authRequiredOutput('Notion')
            },
            section: 'NOTION: reconnexion requise (connector card).'
          }
        }
        return { call: null, section: null }
      }
      if (r.value.items.length === 0) return { call: null, section: null }
      return {
        call: {
          service: 'notion' as const,
          input,
          output: { state: 'complete' as const, items: r.value.items }
        },
        section: clipSection(
          'NOTION RESULTS:',
          r.value.items.map(i => `- "${i.title}"`).join('\n')
        )
      }
    })
  }

  const settled = await Promise.all(tasks.map(task => task()))
  for (const s of settled) {
    if (s.call) calls.push(s.call)
    if (s.section) sections.push(s.section)
  }

  if (sections.length === 0) return { layer: '', calls }
  const layer = `\n\nSERVER-PROVIDED CONNECTOR RESULTS (from the user's own connected accounts — answer from these, do NOT emit tool calls):\n${sections.join('\n')}`
  return {
    layer:
      layer.length > PRELOAD_BUDGET
        ? layer.slice(0, PRELOAD_BUDGET) + '\n…[truncated]'
        : layer,
    calls
  }
}
