import {
  authedFetch,
  connectorGetJson,
  connectorPostJson,
  truncateText
} from './api-client'
import { ConnectorAuthError } from './errors'

/**
 * Read-only clients for the connected provider APIs.
 *
 * Pure data functions: (userId, args) => plain JSON. Used both by the AI
 * tools (`lib/tools/connectors.ts`) and by the server-side preload layer
 * for models that cannot call tools. ConnectorAuthError propagates so the
 * caller can surface a "reconnect" state.
 */

// ---------------------------------------------------------------- Gmail ---

export interface GmailMessageSummary {
  id: string
  subject: string
  from: string
  date: string
  snippet: string
}

function gmailHeader(
  headers: Array<{ name: string; value: string }>,
  name: string
): string {
  return (
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  )
}

async function gmailMetadata(
  userId: string,
  id: string
): Promise<GmailMessageSummary> {
  const msg = await connectorGetJson(
    userId,
    'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
  )
  const headers = (msg.payload?.headers ?? []) as Array<{
    name: string
    value: string
  }>
  return {
    id,
    subject: gmailHeader(headers, 'Subject'),
    from: gmailHeader(headers, 'From'),
    date: gmailHeader(headers, 'Date'),
    snippet: msg.snippet ?? ''
  }
}

export async function gmailSearch(
  userId: string,
  query: string,
  maxResults = 5
): Promise<{ items: GmailMessageSummary[] }> {
  const capped = Math.min(Math.max(maxResults, 1), 10)
  // Blank query = list recent mail (the Gmail API treats a missing q as
  // "all mail", latest first). Never send an empty q= which some gateway
  // configurations reject, yielding a false-empty preload.
  const params = new URLSearchParams({ maxResults: String(capped) })
  if (query.trim()) params.set('q', query)
  const list = await connectorGetJson(
    userId,
    'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`
  )
  const messages = (list.messages ?? []) as Array<{ id: string }>
  const items = await Promise.all(
    messages.map(m => gmailMetadata(userId, m.id))
  )
  return { items }
}

function findPlainBody(payload: any): string | null {
  if (!payload) return null
  if (
    payload.mimeType === 'text/plain' &&
    typeof payload.body?.data === 'string'
  ) {
    return payload.body.data
  }
  for (const part of payload.parts ?? []) {
    const found = findPlainBody(part)
    if (found) return found
  }
  return null
}

function findHtmlBody(payload: any): string | null {
  if (!payload) return null
  if (
    payload.mimeType === 'text/html' &&
    typeof payload.body?.data === 'string'
  ) {
    return payload.body.data
  }
  for (const part of payload.parts ?? []) {
    const found = findHtmlBody(part)
    if (found) return found
  }
  return null
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function gmailRead(
  userId: string,
  messageId: string
): Promise<GmailMessageSummary & { body: string }> {
  const msg = await connectorGetJson(
    userId,
    'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
  )
  const headers = (msg.payload?.headers ?? []) as Array<{
    name: string
    value: string
  }>
  const rawBody = findPlainBody(msg.payload)
  const rawHtml = rawBody ? null : findHtmlBody(msg.payload)
  const body = rawBody
    ? truncateText(Buffer.from(rawBody, 'base64url').toString('utf-8'), 8000)
    : rawHtml
      ? truncateText(
          stripHtml(Buffer.from(rawHtml, 'base64url').toString('utf-8')),
          8000
        )
      : (msg.snippet ?? '')
  return {
    id: messageId,
    subject: gmailHeader(headers, 'Subject'),
    from: gmailHeader(headers, 'From'),
    date: gmailHeader(headers, 'Date'),
    snippet: msg.snippet ?? '',
    body
  }
}

// ---------------------------------------------------------------- Drive ---

export interface DriveFileSummary {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'

export async function driveSearch(
  userId: string,
  query: string,
  maxResults = 10
): Promise<{ items: DriveFileSummary[] }> {
  const capped = Math.min(Math.max(maxResults, 1), 20)
  // Escape single quotes for the Drive query language.
  const safe = query.replace(/'/g, "\\'")
  const q = `name contains '${safe}' and trashed = false`
  const res = await connectorGetJson(
    userId,
    'google',
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')}&pageSize=${capped}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`
  )
  return { items: (res.files ?? []) as DriveFileSummary[] }
}

/** Most recently modified files (fallback when no search keywords). */
export async function driveRecent(
  userId: string,
  maxResults = 5
): Promise<{ items: DriveFileSummary[] }> {
  const capped = Math.min(Math.max(maxResults, 1), 20)
  const res = await connectorGetJson(
    userId,
    'google',
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent('trashed = false')}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')}&pageSize=${capped}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`
  )
  return { items: (res.files ?? []) as DriveFileSummary[] }
}

export async function driveRead(
  userId: string,
  fileId: string
): Promise<DriveFileSummary & { content?: string; readable: boolean }> {
  const meta = (await connectorGetJson(
    userId,
    'google',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,name,mimeType,modifiedTime,size')}`
  )) as DriveFileSummary

  let exportMime: string | null = null
  if (
    meta.mimeType === GOOGLE_DOC_MIME ||
    meta.mimeType === GOOGLE_SLIDES_MIME
  ) {
    exportMime = 'text/plain'
  } else if (meta.mimeType === GOOGLE_SHEET_MIME) {
    exportMime = 'text/csv'
  }

  if (exportMime) {
    const res = await connectorGetJsonRaw(
      userId,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    )
    return { ...meta, content: truncateText(res, 8000), readable: true }
  }

  const size = Number(meta.size ?? 0)
  if (meta.mimeType.startsWith('text/') && size > 0 && size < 100_000) {
    const res = await connectorGetJsonRaw(
      userId,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    )
    return { ...meta, content: truncateText(res, 8000), readable: true }
  }

  return {
    ...meta,
    readable: false
  }
}

async function connectorGetJsonRaw(
  userId: string,
  url: string
): Promise<string> {
  const res = await authedFetch(userId, 'google', url)
  if (!res.ok) {
    // 401-only auth mapping (see api-client): 403s are rate limits,
    // permissions, or export limits — never a reconnect signal.
    if (res.status === 401) {
      throw new ConnectorAuthError('google')
    }
    throw new Error(`Connector API error ${res.status} for ${url}`)
  }
  return truncateText(await res.text(), 12_000)
}

// ------------------------------------------------------------- Calendar ---

export interface CalendarEventSummary {
  id: string
  summary: string
  start: string
  end: string
  allDay: boolean
  location?: string
  attendees?: number
}

export async function calendarList(
  userId: string,
  timeMin?: string,
  timeMax?: string,
  maxResults = 10,
  query?: string,
  timeZone?: string
): Promise<{ items: CalendarEventSummary[] }> {
  const capped = Math.min(Math.max(maxResults, 1), 25)
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(capped),
    timeMin: timeMin || new Date().toISOString(),
    timeMax:
      timeMax || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  })
  if (query) params.set('q', query)
  if (timeZone) params.set('timeZone', timeZone)
  const res = await connectorGetJson(
    userId,
    'google',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`
  )
  const items = ((res.items ?? []) as Array<any>).map(e => ({
    id: e.id as string,
    summary: (e.summary ?? '(no title)') as string,
    start: (e.start?.dateTime ?? e.start?.date ?? '') as string,
    end: (e.end?.dateTime ?? e.end?.date ?? '') as string,
    allDay: Boolean(e.start?.date) && !e.start?.dateTime,
    location: e.location as string | undefined,
    attendees: Array.isArray(e.attendees) ? e.attendees.length : undefined
  }))
  return { items }
}

// --------------------------------------------------------------- GitHub ---

export interface GithubSearchHit {
  repo: string
  path?: string
  title: string
  url: string
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

export async function githubSearch(
  userId: string,
  query: string,
  kind: 'code' | 'repositories' = 'repositories'
): Promise<{ items: GithubSearchHit[] }> {
  if (kind === 'code') {
    const res = await connectorGetJson(
      userId,
      'github',
      `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=10`,
      { headers: GITHUB_HEADERS }
    )
    return {
      items: ((res.items ?? []) as Array<any>).map(i => ({
        repo: i.repository?.full_name ?? '',
        path: i.path as string,
        title: `${i.repository?.full_name ?? ''} — ${i.path as string}`,
        url: i.html_url as string
      }))
    }
  }
  const res = await connectorGetJson(
    userId,
    'github',
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
    { headers: GITHUB_HEADERS }
  )
  return {
    items: ((res.items ?? []) as Array<any>).map(r => ({
      repo: r.full_name as string,
      title: r.full_name as string,
      url: (r.html_url ?? '') as string
    }))
  }
}

/** Most recently updated repos of the user (fallback, no keywords). */
export async function githubRecentRepos(
  userId: string
): Promise<{ items: GithubSearchHit[] }> {
  const res = await connectorGetJson(
    userId,
    'github',
    'https://api.github.com/user/repos?sort=updated&per_page=10',
    { headers: GITHUB_HEADERS }
  )
  return {
    items: (Array.isArray(res) ? res : []).map((r: any) => ({
      repo: r.full_name as string,
      title: r.full_name as string,
      url: (r.html_url ?? '') as string
    }))
  }
}

export async function githubRead(
  userId: string,
  owner: string,
  repo: string,
  path: string
): Promise<{
  type: 'file' | 'dir'
  path: string
  content?: string
  entries?: Array<{ name: string; type: string }>
}> {
  const cleanPath = path.replace(/^\/+/, '')
  const res = await connectorGetJson(
    userId,
    'github',
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath.split('/').map(encodeURIComponent).join('/')}`,
    { headers: GITHUB_HEADERS }
  )
  if (Array.isArray(res)) {
    return {
      type: 'dir',
      path: cleanPath,
      entries: res.map((e: any) => ({
        name: e.name as string,
        type: e.type as string
      }))
    }
  }
  if (res.encoding === 'base64' && typeof res.content === 'string') {
    const size = Number(res.size ?? 0)
    if (size > 300_000) {
      return { type: 'file', path: cleanPath }
    }
    const text = Buffer.from(res.content.replace(/\n/g, ''), 'base64')
      .toString('utf-8')
      .replace(/\0/g, '')
    // Skip binary blobs.
    if (
      text.length > 0 &&
      text.replace(/[^\x09\x0A\x0D\x20-\uFFFF]/g, '').length < text.length * 0.7
    ) {
      return { type: 'file', path: cleanPath }
    }
    return {
      type: 'file',
      path: cleanPath,
      content: truncateText(text, 12_000)
    }
  }
  return { type: 'file', path: cleanPath }
}

// --------------------------------------------------------------- Notion ---

export interface NotionHit {
  id: string
  title: string
  url?: string
}

const NOTION_HEADERS = {
  'Notion-Version': '2022-06-28'
}

function notionTitle(page: any): string {
  const props = page?.properties ?? {}
  for (const value of Object.values(props) as Array<any>) {
    if (value?.type === 'title' && Array.isArray(value.title)) {
      const text = value.title
        .map((t: any) => t?.plain_text ?? '')
        .join('')
        .trim()
      if (text) return text
    }
  }
  return '(untitled)'
}

export async function notionSearch(
  userId: string,
  query: string
): Promise<{ items: NotionHit[] }> {
  // Empty query = list everything shared (most recently edited first).
  const body: Record<string, unknown> = query.trim()
    ? { query, page_size: 10 }
    : {
        page_size: 10,
        sort: { direction: 'descending', timestamp: 'last_edited_time' }
      }
  const res = await connectorPostJson(
    userId,
    'notion',
    'https://api.notion.com/v1/search',
    body,
    { headers: NOTION_HEADERS }
  )
  return {
    items: ((res.results ?? []) as Array<any>).map(r => ({
      id: r.id as string,
      title: notionTitle(r),
      url: r.url as string | undefined
    }))
  }
}

function notionBlockText(block: any): string {
  const type = block?.type as string | undefined
  if (!type) return ''
  const data = block[type]
  const rich = data?.rich_text
  if (Array.isArray(rich)) {
    return rich.map((t: any) => t?.plain_text ?? '').join('')
  }
  return ''
}

function renderNotionLine(block: any): string | null {
  const text = notionBlockText(block).trim()
  if (!text) return null
  if (block.type === 'heading_1') return `# ${text}`
  if (block.type === 'heading_2') return `## ${text}`
  if (block.type === 'heading_3') return `### ${text}`
  if (block.type === 'bulleted_list_item') return `- ${text}`
  if (block.type === 'numbered_list_item') return `1. ${text}`
  if (block.type === 'to_do')
    return `- [${block.to_do?.checked ? 'x' : ' '}] ${text}`
  if (block.type === 'quote') return `> ${text}`
  return text
}

const NOTION_PAGE_SIZE = 50
const NOTION_MAX_BLOCKS = 150

async function fetchNotionBlocks(
  userId: string,
  blockId: string,
  budget: number
): Promise<Array<any>> {
  const out: Array<any> = []
  let cursor: string | undefined
  while (out.length < budget) {
    const params = new URLSearchParams({
      page_size: String(Math.min(NOTION_PAGE_SIZE, budget - out.length))
    })
    if (cursor) params.set('start_cursor', cursor)
    const res = await connectorGetJson(
      userId,
      'notion',
      `https://api.notion.com/v1/blocks/${blockId}/children?${params.toString()}`,
      { headers: NOTION_HEADERS }
    )
    out.push(...((res.results ?? []) as Array<any>))
    if (!res.has_more || typeof res.next_cursor !== 'string') break
    cursor = res.next_cursor
  }
  return out
}

export async function notionRead(
  userId: string,
  pageId: string
): Promise<{ id: string; title: string; content: string }> {
  const normalized = pageId.replace(/-/g, '')
  const [page, top] = await Promise.all([
    connectorGetJson(
      userId,
      'notion',
      `https://api.notion.com/v1/pages/${normalized}`,
      { headers: NOTION_HEADERS }
    ),
    fetchNotionBlocks(userId, normalized, NOTION_MAX_BLOCKS)
  ])
  // One level of nesting (toggles, child lists), fetched in parallel within
  // the same block budget.
  const parentsWithKids = top.filter(b => b?.has_children).slice(0, 10)
  const nestedLists = await Promise.all(
    parentsWithKids.map(parent =>
      fetchNotionBlocks(
        userId,
        String(parent.id).replace(/-/g, ''),
        20
      ).catch(() => [] as Array<any>)
    )
  )
  const kidsByParent = new Map<string, Array<any>>()
  parentsWithKids.forEach((parent, i) =>
    kidsByParent.set(String(parent.id), nestedLists[i] ?? [])
  )
  const lines: string[] = []
  for (const block of top) {
    const line = renderNotionLine(block)
    if (line) lines.push(line)
    for (const kid of kidsByParent.get(String(block?.id)) ?? []) {
      const kidLine = renderNotionLine(kid)
      if (kidLine) lines.push(`  ${kidLine}`)
    }
    if (lines.length >= NOTION_MAX_BLOCKS) break
  }
  return {
    id: pageId,
    title: notionTitle(page),
    content: truncateText(lines.join('\n'), 8000)
  }
}
