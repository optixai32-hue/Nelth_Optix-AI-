export type NormalizedToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

function parseArguments(raw: unknown): Record<string, unknown> | null {
  let parsedObj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') {
    parsedObj = { ...(raw as Record<string, unknown>) }
  } else if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        parsedObj = { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      return null
    }
  }
  if (!parsedObj) return null

  // Unwrap nested parameter wrappers if emitted by LLMs
  if (parsedObj.parameters && typeof parsedObj.parameters === 'object' && !Array.isArray(parsedObj.parameters)) {
    parsedObj = { ...parsedObj, ...(parsedObj.parameters as Record<string, unknown>) }
  } else if (parsedObj.input && typeof parsedObj.input === 'object' && !Array.isArray(parsedObj.input)) {
    parsedObj = { ...parsedObj, ...(parsedObj.input as Record<string, unknown>) }
  } else if (parsedObj.args && typeof parsedObj.args === 'object' && !Array.isArray(parsedObj.args)) {
    parsedObj = { ...parsedObj, ...(parsedObj.args as Record<string, unknown>) }
  }

  return parsedObj
}

const VALID_CONTENT_TYPES = new Set(['web', 'video', 'image', 'news'])

function asStringArray(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : []
  return list.filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  )
}

function normalizeSearchArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const query = String(input.query ?? input.q ?? input.search_query ?? '').trim()
  const rawDepth = String(input.search_depth ?? input.depth ?? '').toLowerCase()
  const rawType = String(input.type ?? input.source ?? '').toLowerCase()
  const maxResults = Number(
    input.max_results ?? input.topk ?? input.limit ?? 10
  )
  // Preserve the model's requested content types (image search depends on
  // it) — fall back to web-only when nothing valid was given.
  const requested = asStringArray(input.content_types)
    .map(t => t.toLowerCase())
    .filter(t => VALID_CONTENT_TYPES.has(t))
  // Preserve domain allow/deny lists instead of wiping them.
  const includeDomains = asStringArray(input.include_domains)
  const excludeDomains = asStringArray(input.exclude_domains)

  return {
    query,
    type: rawType === 'general' ? 'general' : 'optimized',
    content_types: requested.length > 0 ? requested : ['web'],
    max_results: Number.isFinite(maxResults)
      ? Math.max(1, Math.floor(maxResults))
      : 10,
    search_depth:
      rawDepth === 'advanced' || rawDepth === 'medium' ? 'advanced' : 'basic',
    include_domains: includeDomains,
    exclude_domains: excludeDomains
  }
}

function normalizeImageArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const prompt = String(
    input.prompt ??
      input.description ??
      input.query ??
      input.q ??
      input.text ??
      input.caption ??
      input.image_prompt ??
      input.prompt_text ??
      input.user_prompt ??
      input.subject ??
      input.content ??
      input.title ??
      ''
  ).trim()

  return {
    ...input,
    prompt,
    ...(input.image || input.image_url || input.imageUrl
      ? { image: input.image ?? input.image_url ?? input.imageUrl }
      : {})
  }
}

function normalizeGmailArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawAction = String(input.action ?? input.operation ?? '').toLowerCase()
  const messageId = String(input.messageId ?? input.id ?? input.message_id ?? '').trim()
  const action = (rawAction === 'read' || rawAction === 'get' || (messageId && rawAction !== 'search'))
    ? 'read'
    : 'search'
  const query = String(input.query ?? input.q ?? '').trim()
  const maxResults = Number(input.maxResults ?? input.max_results ?? input.limit ?? 5)

  return {
    action,
    query,
    maxResults: Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 5,
    ...(messageId ? { messageId } : {})
  }
}

function normalizeDriveArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawAction = String(input.action ?? input.operation ?? '').toLowerCase()
  const fileId = String(input.fileId ?? input.id ?? input.file_id ?? '').trim()
  const action = (rawAction === 'read' || rawAction === 'get' || (fileId && rawAction !== 'search'))
    ? 'read'
    : 'search'
  const query = String(input.query ?? input.q ?? input.name ?? input.fileName ?? input.file_name ?? '').trim()
  const maxResults = Number(input.maxResults ?? input.max_results ?? input.limit ?? 10)

  return {
    action,
    query,
    maxResults: Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 10,
    ...(fileId ? { fileId } : {})
  }
}

function normalizeCalendarArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const timeMin = String(input.timeMin ?? input.start ?? input.startDate ?? input.start_date ?? input.from ?? '').trim()
  const timeMax = String(input.timeMax ?? input.end ?? input.endDate ?? input.end_date ?? input.to ?? '').trim()
  const query = String(input.query ?? input.q ?? input.event ?? '').trim()
  const maxResults = Number(input.maxResults ?? input.max_results ?? input.limit ?? 10)
  const timeZone = input.timeZone ? String(input.timeZone) : undefined

  return {
    maxResults: Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 10,
    ...(timeMin ? { timeMin } : {}),
    ...(timeMax ? { timeMax } : {}),
    ...(query ? { query } : {}),
    ...(timeZone ? { timeZone } : {})
  }
}

function normalizeGithubArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawAction = String(input.action ?? input.operation ?? '').toLowerCase()
  const owner = String(input.owner ?? input.user ?? input.username ?? '').trim()
  const repo = String(input.repo ?? input.repository ?? input.project ?? '').trim()
  const path = String(input.path ?? input.file ?? input.filePath ?? '').trim()
  const action = (rawAction === 'read' || rawAction === 'get' || (owner && repo && path && rawAction !== 'search'))
    ? 'read'
    : 'search'
  const query = String(input.query ?? input.q ?? '').trim()
  const kind = String(input.kind ?? 'repositories').toLowerCase() === 'code' ? 'code' : 'repositories'

  return {
    action,
    query,
    kind,
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    ...(path ? { path } : {})
  }
}

function normalizeNotionArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawAction = String(input.action ?? input.operation ?? '').toLowerCase()
  const pageId = String(input.pageId ?? input.id ?? input.page_id ?? '').trim()
  const action = (rawAction === 'read' || rawAction === 'get' || (pageId && rawAction !== 'search'))
    ? 'read'
    : 'search'
  const query = String(input.query ?? input.q ?? input.title ?? '').trim()

  return {
    action,
    query,
    ...(pageId ? { pageId } : {})
  }
}

export function normalizeToolCall(
  id: string,
  name: string,
  rawArguments: unknown
): NormalizedToolCall | null {
  const input = parseArguments(rawArguments)
  if (!input) return null

  const lower = name.toLowerCase().replace(/[-_]/g, '')
  let normalizedName = name
  let args = input

  if (lower.includes('search') && !lower.includes('gmail') && !lower.includes('drive') && !lower.includes('notion') && !lower.includes('github')) {
    normalizedName = 'search'
    args = normalizeSearchArguments(input)
  } else if (lower.includes('generateimage') || lower.includes('createimage') || (lower.includes('image') && !lower.includes('search'))) {
    normalizedName = 'generateImage'
    args = normalizeImageArguments(input)
  } else if (lower.includes('gmail') || lower.includes('mail') || lower.includes('email')) {
    normalizedName = 'gmail'
    args = normalizeGmailArguments(input)
  } else if (lower.includes('drive') || lower.includes('googledrive')) {
    normalizedName = 'drive'
    args = normalizeDriveArguments(input)
  } else if (lower.includes('calendar') || lower.includes('agenda') || lower.includes('googlecalendar')) {
    normalizedName = 'calendar'
    args = normalizeCalendarArguments(input)
  } else if (lower.includes('github') || lower.includes('git')) {
    normalizedName = 'github'
    args = normalizeGithubArguments(input)
  } else if (lower.includes('notion')) {
    normalizedName = 'notion'
    args = normalizeNotionArguments(input)
  }

  return { id, name: normalizedName, arguments: args }
}
