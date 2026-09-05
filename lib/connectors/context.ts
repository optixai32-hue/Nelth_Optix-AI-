import { foldText, intentRe } from '@/lib/skills/text-fold'

import { ConnectorAuthError } from './api-client'
import {
  calendarList,
  driveSearch,
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
    '- Cite what you actually found (subject / file name / date). If nothing was found, say so plainly.'
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

/**
 * Best-effort fetch across every connected provider for models that cannot
 * call tools. Returns a text layer (possibly empty) to inject like the
 * preloaded web-search layer. Failures are silent per provider; an expired
 * grant surfaces as a one-line "reconnect" note instead of an error.
 */
export async function runConnectorPreload(
  userId: string,
  query: string,
  status: ConnectorStatus
): Promise<string> {
  const q = (query ?? '').trim().slice(0, 200)
  if (!q) return ''
  const sections: string[] = []

  const jobs: Array<Promise<void>> = []
  if (status.google) {
    jobs.push(
      gmailSearch(userId, q, 3).then(
        r => {
          if (r.items.length === 0) return
          sections.push(
            clipSection(
              'GMAIL RESULTS:',
              r.items
                .map(
                  i =>
                    `- "${i.subject}" — ${i.from} (${i.date})\n  ${i.snippet}`
                )
                .join('\n')
            )
          )
        },
        e => {
          if (e instanceof ConnectorAuthError) {
            sections.push('GMAIL: reconnexion requise (connector card).')
          }
        }
      ),
      driveSearch(userId, q, 5).then(
        r => {
          if (r.items.length === 0) return
          sections.push(
            clipSection(
              'DRIVE RESULTS:',
              r.items.map(i => `- "${i.name}" (${i.mimeType})`).join('\n')
            )
          )
        },
        e => {
          if (e instanceof ConnectorAuthError) {
            sections.push('DRIVE: reconnexion requise (connector card).')
          }
        }
      ),
      calendarList(userId).then(
        r => {
          if (r.items.length === 0) return
          sections.push(
            clipSection(
              'CALENDAR (next 7 days):',
              r.items.map(i => `- "${i.summary}" — ${i.start}`).join('\n')
            )
          )
        },
        () => {}
      )
    )
  }
  if (status.github) {
    jobs.push(
      githubSearch(userId, q, 'repositories').then(
        r => {
          if (r.items.length === 0) return
          sections.push(
            clipSection(
              'GITHUB RESULTS:',
              r.items.map(i => `- ${i.title} (${i.url})`).join('\n')
            )
          )
        },
        e => {
          if (e instanceof ConnectorAuthError) {
            sections.push('GITHUB: reconnexion requise (connector card).')
          }
        }
      )
    )
  }
  if (status.notion) {
    jobs.push(
      notionSearch(userId, q).then(
        r => {
          if (r.items.length === 0) return
          sections.push(
            clipSection(
              'NOTION RESULTS:',
              r.items.map(i => `- "${i.title}"`).join('\n')
            )
          )
        },
        e => {
          if (e instanceof ConnectorAuthError) {
            sections.push('NOTION: reconnexion requise (connector card).')
          }
        }
      )
    )
  }

  await Promise.all(jobs)
  if (sections.length === 0) return ''
  const layer = `\n\nSERVER-PROVIDED CONNECTOR RESULTS (from the user's own connected accounts — answer from these, do NOT emit tool calls):\n${sections.join('\n')}`
  return layer.length > PRELOAD_BUDGET
    ? layer.slice(0, PRELOAD_BUDGET) + '\n…[truncated]'
    : layer
}
