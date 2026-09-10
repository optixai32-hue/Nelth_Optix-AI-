import { tool } from 'ai'
import { z } from 'zod'

import { ConnectorAuthError } from '@/lib/connectors/errors'
import type { ConnectorProviderId } from '@/lib/connectors/providers'
import {
  calendarList,
  driveRead,
  driveRecent,
  driveSearch,
  githubRead,
  githubRecentRepos,
  githubSearch,
  gmailRead,
  gmailSearch,
  notionRead,
  notionSearch
} from '@/lib/connectors/service-clients'
import { markConnectorAuthFailure } from '@/lib/connectors/vault'
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

async function authRequired(
  userId: string,
  provider: ConnectorProviderId,
  label: string
) {
  // Persist the dead grant so the status route reports needsReconnect and
  // the card offers Reconnect instead of staying green.
  await markConnectorAuthFailure(userId, provider)
  return {
    state: 'auth-required' as const,
    provider: label,
    message: `The ${label} connection expired or was revoked. Tell the user to reconnect it from the "Connecter une application" connector card, then ask again.`
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
        .enum(['search', 'read', 'list', 'get'])
        .optional()
        .default('search')
        .describe('search: find messages; read: full body of one message'),
      operation: z.string().optional().describe('Alias for action'),
      query: z
        .string()
        .optional()
        .describe('Gmail search query (same syntax as Gmail search box)'),
      q: z.string().optional().describe('Alias for query'),
      maxResults: z.number().optional().default(5),
      messageId: z
        .string()
        .optional()
        .describe('Message id from a previous search (for action=read)'),
      id: z.string().optional().describe('Alias for messageId')
    }),
    async *execute(params) {
      yield { state: 'connecting' as const, service: 'gmail' as const }
      try {
        const effectiveAction =
          (params.action === 'read' || params.action === 'get' || params.operation === 'read' || params.operation === 'get')
            ? 'read'
            : 'search'
        const effectiveId = params.messageId || params.id
        const effectiveQuery = params.query ?? params.q ?? ''
        const maxResults = params.maxResults ?? 5

        if (effectiveAction === 'read') {
          if (!effectiveId) {
            yield toolError('messageId is required for action=read')
            return
          }
          const msg = await gmailRead(userId, effectiveId)
          logToolPayload('gmail', effectiveId, { body: msg.body })
          yield { state: 'complete' as const, ...msg }
          return
        }
        // Empty query = list recent mail (same as the server preload).
        const res = await gmailSearch(userId, effectiveQuery, maxResults)
        logToolPayload('gmail', effectiveQuery, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          yield await authRequired(userId, 'google', 'Google')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const driveTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN Google Drive files. Use when the user asks about their documents ('mon fichier…', 'retrouve le doc…', 'dans mon Drive'). Search first, then read a file id for its text content.",
    inputSchema: z.object({
      action: z
        .enum(['search', 'read', 'list', 'get'])
        .optional()
        .default('search')
        .describe('search: find files; read: content of one file'),
      operation: z.string().optional().describe('Alias for action'),
      query: z.string().optional().describe('File name to look for'),
      q: z.string().optional().describe('Alias for query'),
      name: z.string().optional().describe('Alias for query'),
      fileName: z.string().optional().describe('Alias for query'),
      maxResults: z.number().optional().default(10),
      fileId: z
        .string()
        .optional()
        .describe('File id from a previous search (for action=read)'),
      id: z.string().optional().describe('Alias for fileId')
    }),
    async *execute(params) {
      yield { state: 'connecting' as const, service: 'drive' as const }
      try {
        const effectiveAction =
          (params.action === 'read' || params.action === 'get' || params.operation === 'read' || params.operation === 'get')
            ? 'read'
            : 'search'
        const effectiveId = params.fileId || params.id
        const effectiveQuery = params.query ?? params.q ?? params.name ?? params.fileName ?? ''
        const maxResults = params.maxResults ?? 10

        if (effectiveAction === 'read') {
          if (!effectiveId) {
            yield toolError('fileId is required for action=read')
            return
          }
          const file = await driveRead(userId, effectiveId)
          logToolPayload('drive', effectiveId, { content: file.content ?? '' })
          yield { state: 'complete' as const, ...file }
          return
        }
        // Empty query = list recent files (same as the server preload).
        const res = effectiveQuery.trim()
          ? await driveSearch(userId, effectiveQuery, maxResults)
          : await driveRecent(userId, maxResults)
        logToolPayload('drive', effectiveQuery, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          yield await authRequired(userId, 'google', 'Google')
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
      start: z.string().optional().describe('Alias for timeMin'),
      startDate: z.string().optional().describe('Alias for timeMin'),
      from: z.string().optional().describe('Alias for timeMin'),
      end: z.string().optional().describe('Alias for timeMax'),
      endDate: z.string().optional().describe('Alias for timeMax'),
      to: z.string().optional().describe('Alias for timeMax'),
      maxResults: z.number().optional().default(10),
      query: z.string().optional().describe('Keyword filter (e.g. "dentiste")'),
      q: z.string().optional().describe('Alias for query'),
      timeZone: z
        .string()
        .optional()
        .describe('IANA time zone (e.g. "Indian/Antananarivo") for display')
    }),
    async *execute(params) {
      yield { state: 'connecting' as const, service: 'calendar' as const }
      try {
        const timeMin = params.timeMin || params.start || params.startDate || params.from
        const timeMax = params.timeMax || params.end || params.endDate || params.to
        const query = params.query ?? params.q
        const maxResults = params.maxResults ?? 10

        const res = await calendarList(
          userId,
          timeMin,
          timeMax,
          maxResults,
          query,
          params.timeZone
        )
        logToolPayload('calendar', query ?? '', { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          yield await authRequired(userId, 'google', 'Google')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const githubTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN GitHub repositories and code. Use when the user asks about their repos ('mon repo…', 'retrouve le fichier… sur GitHub'). Search first, then read owner/repo/path.",
    inputSchema: z.object({
      action: z
        .enum(['search', 'read', 'list', 'get'])
        .optional()
        .default('search'),
      operation: z.string().optional().describe('Alias for action'),
      query: z
        .string()
        .optional()
        .describe('Search keywords (for action=search)'),
      q: z.string().optional().describe('Alias for query'),
      kind: z.enum(['code', 'repositories']).optional().default('repositories'),
      owner: z.string().optional(),
      repo: z.string().optional(),
      repository: z.string().optional().describe('Alias for repo'),
      path: z.string().optional().describe('File or directory path in the repo')
    }),
    async *execute(params) {
      yield { state: 'connecting' as const, service: 'github' as const }
      try {
        const effectiveAction =
          (params.action === 'read' || params.action === 'get' || params.operation === 'read' || params.operation === 'get')
            ? 'read'
            : 'search'
        const effectiveRepo = params.repo || params.repository
        const effectiveQuery = params.query ?? params.q ?? ''
        const kind = params.kind ?? 'repositories'

        if (effectiveAction === 'read') {
          if (!params.owner || !effectiveRepo || !params.path) {
            yield toolError('owner, repo and path are required for action=read')
            return
          }
          const res = await githubRead(userId, params.owner, effectiveRepo, params.path)
          logToolPayload('github', `${params.owner}/${effectiveRepo}/${params.path}`, {
            content: 'content' in res ? (res.content ?? '') : ''
          })
          yield { state: 'complete' as const, ...res }
          return
        }
        if (!effectiveQuery.trim()) {
          if (kind === 'code') {
            yield toolError('query is required to search code')
            return
          }
          // Empty query = list recent repos (same as the server preload).
          const recent = await githubRecentRepos(userId)
          logToolPayload('github', effectiveQuery, { items: recent.items })
          yield { state: 'complete' as const, ...recent }
          return
        }
        const res = await githubSearch(userId, effectiveQuery, kind)
        logToolPayload('github', effectiveQuery, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          yield await authRequired(userId, 'github', 'GitHub')
        else yield toolError(e instanceof Error ? e.message : String(e))
      }
    }
  })

const notionTool = (userId: string) =>
  tool({
    description:
      "Search and read the user's OWN Notion pages shared with the integration. Use when the user asks about their notes ('ma page Notion…', 'retrouve dans Notion'). Search first, then read a page id.",
    inputSchema: z.object({
      action: z
        .enum(['search', 'read', 'list', 'get'])
        .optional()
        .default('search'),
      operation: z.string().optional().describe('Alias for action'),
      query: z.string().optional().describe('Page title keywords'),
      q: z.string().optional().describe('Alias for query'),
      pageId: z
        .string()
        .optional()
        .describe('Page id from a previous search (for action=read)'),
      id: z.string().optional().describe('Alias for pageId')
    }),
    async *execute(params) {
      yield { state: 'connecting' as const, service: 'notion' as const }
      try {
        const effectiveAction =
          (params.action === 'read' || params.action === 'get' || params.operation === 'read' || params.operation === 'get')
            ? 'read'
            : 'search'
        const effectiveId = params.pageId || params.id
        const effectiveQuery = params.query ?? params.q ?? ''

        if (effectiveAction === 'read') {
          if (!effectiveId) {
            yield toolError('pageId is required for action=read')
            return
          }
          const page = await notionRead(userId, effectiveId)
          logToolPayload('notion', effectiveId, { content: page.content })
          yield { state: 'complete' as const, ...page }
          return
        }
        // Empty query = list everything shared (same as the server preload).
        const res = await notionSearch(userId, effectiveQuery)
        logToolPayload('notion', effectiveQuery, { items: res.items })
        yield { state: 'complete' as const, ...res }
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          yield await authRequired(userId, 'notion', 'Notion')
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
