export type NormalizedToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

function parseArguments(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') {
    return { ...(raw as Record<string, unknown>) }
  }
  if (typeof raw !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? { ...(parsed as Record<string, unknown>) }
      : null
  } catch {
    return null
  }
}

const VALID_CONTENT_TYPES = new Set(['web', 'video', 'image', 'news'])

function asStringArray(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function normalizeSearchArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  const query = String(input.query ?? input.q ?? '').trim()
  const rawDepth = String(input.search_depth ?? input.depth ?? '').toLowerCase()
  const rawType = String(input.type ?? input.source ?? '').toLowerCase()
  const maxResults = Number(input.max_results ?? input.topk ?? input.limit ?? 10)
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
    max_results: Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 10,
    search_depth: rawDepth === 'advanced' || rawDepth === 'medium' ? 'advanced' : 'basic',
    include_domains: includeDomains,
    exclude_domains: excludeDomains
  }
}

function normalizeImageArguments(
  input: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...input,
    prompt: String(input.prompt ?? input.description ?? '').trim(),
    ...(input.image || input.image_url || input.imageUrl
      ? { image: input.image ?? input.image_url ?? input.imageUrl }
      : {})
  }
}

export function normalizeToolCall(
  id: string,
  name: string,
  rawArguments: unknown
): NormalizedToolCall | null {
  const input = parseArguments(rawArguments)
  if (!input) return null

  const normalizedName = name.toLowerCase().includes('search')
    ? 'search'
    : name.toLowerCase().includes('generateimage') ||
        name.toLowerCase().includes('image')
      ? 'generateImage'
      : name

  const args =
    normalizedName === 'search'
      ? normalizeSearchArguments(input)
      : normalizedName === 'generateImage'
        ? normalizeImageArguments(input)
        : input

  return { id, name: normalizedName, arguments: args }
}
