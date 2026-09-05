import { tool } from 'ai'
import { z } from 'zod'

import { ConnectorAuthError } from '@/lib/connectors/api-client'
import {
  calendarList,
  driveRead,
  driveSearch,
  githubRead,
  githubSearch,
  gmailRead,
  gmailSearch,
  notionRead,
  notionSearch
} from '@/lib/connectors/service-clients'
import { logToolPayload } from '@/lib/utils/usage-logging'

/**
 * Read-only connector tools: the model reaches the user's OWN connected
 * accounts (Gmail, Drive, Calendar, GitHub, Notion) through the encrypted
 * server vault. Tokens never appear in inputs, outputs, or the prompt.
 *
 * Every tool streams a `{ state: 'connecting' }` beat first so the UI can
 * show a Gemini-style activity shimmer ("Connexion à Gmail…"), then a final
 * `{ state: 'complete' | 'auth-required' | 'error' }` payload.
 */

function authRequired(provider: string) {
  return {
    state: 'auth-required' as const,
    provider,
    message: `The ${provider} connection expired or was revoked. Tell the user to reconnect it from the "Connecter une application" connector card, then ask again.`
  }
}

function toolError(message: string) {
  return { state: 'error' as const, message }
}

const gmailTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN Gmail messages. Use when the user asks about their emails (e.g. 'mes mails', 'un mail de…', 'retrouve le message sur…'). Search first, then read a specific message id for the full body.",
    inputSchema: z.object({
      action: z
        .enum(['search', 'read'])
        .describe('search: find messages; read: full body of one message'),
      query: z
        .string()
        .optional()
        .describe('Gmail search query (same syntax as Gmail search box)'),
      maxResults: z.number().optional().default(5),
      messageId: z
        .string()
        .optional()
        .describe('Message id from a previous search (for action=read)')
    }),
    async *execute({ action, query = '', maxResults = 5, messageId }) {
      yield { state: 'connecting' as const, service: 'gmail' as const }
      try {
        if (action === 'read') {
          if (!messageId) {
            yield toolError('messageId is required for action=read')
            return
          }
          const msg = await gmailRead(userId, messageId)
          logToolPayload('gmail', messageId, { body: msg.body })
          yield { state: 'complete' as const, ...msg }
          return
        }
        if (!query.trim()) {
          yield toolError('query is required for action=search')
          return
        }
        const res = await gmailSearch(userId, query, maxResults)
        logToolPayload('gmail', query, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError) yield authRequired('Google')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const driveTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN Google Drive files. Use when the user asks about their documents ('mon fichier…', 'retrouve le doc…', 'dans mon Drive'). Search first, then read a file id for its text content.",
    inputSchema: z.object({
      action: z.enum(['search', 'read']),
      query: z.string().optional().describe('File name to look for'),
      maxResults: z.number().optional().default(10),
      fileId: z
        .string()
        .optional()
        .describe('File id from a previous search (for action=read)')
    }),
    async *execute({ action, query = '', maxResults = 10, fileId }) {
      yield { state: 'connecting' as const, service: 'drive' as const }
      try {
        if (action === 'read') {
          if (!fileId) {
            yield toolError('fileId is required for action=read')
            return
          }
          const file = await driveRead(userId, fileId)
          logToolPayload('drive', fileId, { content: file.content ?? '' })
          yield { state: 'complete' as const, ...file }
          return
        }
        if (!query.trim()) {
          yield toolError('query is required for action=search')
          return
        }
        const res = await driveSearch(userId, query, maxResults)
        logToolPayload('drive', query, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError) yield authRequired('Google')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const calendarTool = (userId: string) =>
  tool({
    description:
      "List the user's OWN Google Calendar events. Use when the user asks about their schedule ('mon agenda', 'mes réunions', 'quoi cette semaine'). Defaults to the next 7 days.",
    inputSchema: z.object({
      timeMin: z.string().optional().describe('ISO start (default: now)'),
      timeMax: z.string().optional().describe('ISO end (default: +7 days)'),
      maxResults: z.number().optional().default(10),
      query: z.string().optional().describe('Keyword filter (e.g. "dentiste")')
    }),
    async *execute({ timeMin, timeMax, maxResults = 10, query }) {
      yield { state: 'connecting' as const, service: 'calendar' as const }
      try {
        const res = await calendarList(
          userId,
          timeMin,
          timeMax,
          maxResults,
          query
        )
        logToolPayload('calendar', query, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError) yield authRequired('Google')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const githubTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN GitHub repositories and code. Use when the user asks about their repos ('mon repo…', 'retrouve le fichier… sur GitHub'). Search first, then read owner/repo/path.",
    inputSchema: z.object({
      action: z.enum(['search', 'read']),
      query: z
        .string()
        .optional()
        .describe('Search keywords (for action=search)'),
      kind: z.enum(['code', 'repositories']).optional().default('repositories'),
      owner: z.string().optional(),
      repo: z.string().optional(),
      path: z.string().optional().describe('File or directory path in the repo')
    }),
    async *execute({
      action,
      query = '',
      kind = 'repositories',
      owner,
      repo,
      path
    }) {
      yield { state: 'connecting' as const, service: 'github' as const }
      try {
        if (action === 'read') {
          if (!owner || !repo || !path) {
            yield toolError('owner, repo and path are required for action=read')
            return
          }
          const res = await githubRead(userId, owner, repo, path)
          logToolPayload('github', `${owner}/${repo}/${path}`, {
            content: 'content' in res ? (res.content ?? '') : ''
          })
          yield { state: 'complete' as const, ...res }
          return
        }
        if (!query.trim()) {
          yield toolError('query is required for action=search')
          return
        }
        const res = await githubSearch(userId, query, kind)
        logToolPayload('github', query, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError) yield authRequired('GitHub')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const notionTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN Notion pages shared with the integration. Use when the user asks about their notes ('ma page Notion…', 'retrouve dans Notion'). Search first, then read a page id.",
    inputSchema: z.object({
      action: z.enum(['search', 'read']),
      query: z.string().optional().describe('Page title keywords'),
      pageId: z
        .string()
        .optional()
        .describe('Page id from a previous search (for action=read)')
    }),
    async *execute({ action, query = '', pageId }) {
      yield { state: 'connecting' as const, service: 'notion' as const }
      try {
        if (action === 'read') {
          if (!pageId) {
            yield toolError('pageId is required for action=read')
            return
          }
          const page = await notionRead(userId, pageId)
          logToolPayload('notion', pageId, { content: page.content })
          yield { state: 'complete' as const, ...page }
          return
        }
        if (!query.trim()) {
          yield toolError('query is required for action=search')
          return
        }
        const res = await notionSearch(userId, query)
        logToolPayload('notion', query, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError) yield authRequired('Notion')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

/** Builds the five connector tools bound to one user (server-side only). */
export function createConnectorTools(userId: string) {
  return {
    gmail: gmailTool(userId),
    drive: driveTool(userId),
    calendar: calendarTool(userId),
    github: githubTool(userId),
    notion: notionTool(userId)
  }
}

export type ConnectorTools = ReturnType<typeof createConnectorTools>
export type ConnectorToolName = keyof ConnectorTools

export const CONNECTOR_TOOL_NAMES: ConnectorToolName[] = [
  'gmail',
  'drive',
  'calendar',
  'github',
  'notion'
]
