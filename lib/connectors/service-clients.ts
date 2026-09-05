import {
  authedFetch,
  ConnectorAuthError,
  connectorGetJson,
  connectorPostJson,
  truncateText
} from './api-client'

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
  const list = await connectorGetJson(
    userId,
    'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${capped}`
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
  const body = rawBody
    ? truncateText(Buffer.from(rawBody, 'base64url').toString('utf-8'), 8000)
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
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')}&pageSize=${capped}&orderBy=modifiedTime desc`
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
    if (res.status === 401 || res.status === 403) {
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
  location?: string
  attendees?: number
}

export async function calendarList(
  userId: string,
  timeMin?: string,
  timeMax?: string,
  maxResults = 10,
  query?: string
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
  const res = await connectorPostJson(
    userId,
    'notion',
    'https://api.notion.com/v1/search',
    { query, page_size: 10 },
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

export async function notionRead(
  userId: string,
  pageId: string
): Promise<{ id: string; title: string; content: string }> {
  const normalized = pageId.replace(/-/g, '')
  const [page, blocks] = await Promise.all([
    connectorGetJson(
      userId,
      'notion',
      `https://api.notion.com/v1/pages/${normalized}`,
      { headers: NOTION_HEADERS }
    ),
    connectorGetJson(
      userId,
      'notion',
      `https://api.notion.com/v1/blocks/${normalized}/children?page_size=50`,
      { headers: NOTION_HEADERS }
    )
  ])
  const lines = ((blocks.results ?? []) as Array<any>)
    .map(b => {
      const text = notionBlockText(b).trim()
      if (!text) return null
      if (b.type === 'heading_1') return `# ${text}`
      if (b.type === 'heading_2') return `## ${text}`
      if (b.type === 'heading_3') return `### ${text}`
      if (b.type === 'bulleted_list_item') return `- ${text}`
      if (b.type === 'numbered_list_item') return `1. ${text}`
      if (b.type === 'to_do')
        return `- [${b.to_do?.checked ? 'x' : ' '}] ${text}`
      if (b.type === 'quote') return `> ${text}`
      return text
    })
    .filter((l): l is string => l !== null)
  return {
    id: pageId,
    title: notionTitle(page),
    content: truncateText(lines.join('\n'), 8000)
  }
}
