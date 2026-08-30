import { SearchResults, SearchResultItem, SearchResultImage } from '@/lib/types'

/**
 * NelthWeb search provider — the single, authoritative web + image search backend.
 *
 * Replaces every previous provider (Tavily / Brave / DuckDuckGo / SearXNG). All
 * web and image search now goes through the NelthWeb API:
 *   - Web (with citations): https://nelthweb.space-z.ai/api/search?q=...&format=citations&num=N
 *   - Images:              https://nelthweb.space-z.ai/api/image-search?q=...&count=N
 */

const NELTHWEB_BASE = 'https://nelthweb.space-z.ai'
const DEFAULT_NUM = 5
const DEFAULT_IMAGE_COUNT = 8

interface NelthWebSearchResult {
  citation?: string
  title?: string
  description?: string
  url?: string
  link?: string
}

interface NelthWebSearchResponse {
  bibliography?: unknown[]
  results?: NelthWebSearchResult[]
}

interface NelthWebImageResult {
  url?: string
  width?: number
  height?: number
  source?: string
}

interface NelthWebImageResponse {
  results?: NelthWebImageResult[]
}

function buildUrl(
  path: string,
  params: Record<string, string>
): string {
  const usp = new URLSearchParams(params)
  return `${NELTHWEB_BASE}${path}?${usp.toString()}`
}

const NELTHWEB_TIMEOUT_MS = 12000

async function fetchWithRetry(
  url: string,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NELTHWEB_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (res.ok) return res
      // Retry on server errors (5xx) and rate limits (429)
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status} ${res.statusText}`)
        const delay = baseDelayMs * 2 ** attempt + Math.random() * 200
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      // Non-retryable error — return the response so caller can handle it
      return res
    } catch (err) {
      clearTimeout(timeout)
      lastError = err instanceof Error ? err : new Error(String(err))
      // AbortError means the request timed out — treat as retryable transient failure
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt + Math.random() * 200
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError ?? new Error('NelthWeb request failed after retries')
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * Best-effort extraction of a usable URL for a web result. NelthWeb's citation
 * format may place the canonical URL either on the result object or inside the
 * bibliography entry for that index. We try both, falling back gracefully.
 */
function resolveWebUrl(
  result: NelthWebSearchResult,
  bibliography: unknown[] | undefined,
  index: number
): string {
  const fromResult = asString(result.url) || asString(result.link)
  if (fromResult) return fromResult

  const bib = bibliography?.[index]
  if (bib == null) return ''
  const bibStr = asString(bib)
  // Bibliography entries often look like "[1] Title — https://example.com" or
  // contain a bare URL. Extract the first http(s) URL if present.
  const match = bibStr.match(/https?:\/\/[^\s)\]]+/)
  return match ? match[0] : ''
}

/**
 * Normalize the NelthWeb web-search payload into the app's SearchResults shape.
 * `results` is the source of truth; `bibliography` only supplies missing URLs.
 */
function mapWebResponse(
  data: NelthWebSearchResponse,
  query: string
): SearchResults {
  const bibliography = data.bibliography
  const rawResults = Array.isArray(data.results) ? data.results : []

  const results: SearchResultItem[] = rawResults.map((r, i) => {
    const title = asString(r.title) || asString(r.citation) || 'Sans titre'
    const description = asString(r.description)
    const url = resolveWebUrl(r, bibliography, i)
    const citation = asString(r.citation)
    // Content MUST be the actual description text so the model can answer from it.
    // The citation marker ([1], [2]…) is only for inline citation referencing.
    const content = description
      ? citation
        ? `${description} ${citation}`
        : description
      : title
    return { title, url, content }
  })

  return {
    results,
    images: [],
    query,
    number_of_results: results.length
  }
}

/**
 * Normalize the NelthWeb image-search payload into the app's SearchResults shape.
 * Image results are surfaced via the `images` field (url strings), which the
 * gallery/UI consumes. `results` stays empty for a pure image search.
 */
function mapImageResponse(
  data: NelthWebImageResponse,
  query: string
): SearchResults {
  const rawImages = Array.isArray(data.results) ? data.results : []

  const images: SearchResultImage[] = rawImages
    .map(img => asString(img.url))
    .filter(url => url.length > 0)

  return {
    results: [],
    images,
    query,
    number_of_results: images.length
  }
}

export class NelthWebSearchProvider {
  async search(
    query: string,
    maxResults: number,
    _searchDepth: 'basic' | 'advanced',
    _includeDomains: string[],
    _excludeDomains: string[],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    const contentTypes = options?.content_types ?? ['web']
    const wantsImages = contentTypes.includes('image')
    const wantsWeb = contentTypes.includes('web') || contentTypes.length === 0

    // When the request is image-only, hit the image endpoint directly.
    if (wantsImages && !wantsWeb) {
      const url = buildUrl('/api/image-search', {
        q: query,
        count: String(maxResults || DEFAULT_IMAGE_COUNT)
      })
      const res = await fetchWithRetry(url)
      if (!res.ok) {
        throw new Error(
          `NelthWeb image search failed: ${res.status} ${res.statusText}`
        )
      }
      const data = (await res.json()) as NelthWebImageResponse
      return mapImageResponse(data, query)
    }

    // Web (with citations). When images are also wanted we still run the web
    // search first, then augment with an image search in parallel.
    const webUrl = buildUrl('/api/search', {
      q: query,
      format: 'citations',
      num: String(Math.max(maxResults || DEFAULT_NUM, 1))
    })

    const webPromise = (async () => {
      const res = await fetchWithRetry(webUrl)
      if (!res.ok) {
        throw new Error(
          `NelthWeb search failed: ${res.status} ${res.statusText}`
        )
      }
      const data = (await res.json()) as NelthWebSearchResponse
      return mapWebResponse(data, query)
    })()

    if (!wantsImages) {
      return webPromise
    }

    const imageUrl = buildUrl('/api/image-search', {
      q: query,
      count: String(maxResults || DEFAULT_IMAGE_COUNT)
    })
    const imagePromise = (async () => {
      try {
        const res = await fetchWithRetry(imageUrl)
        if (!res.ok) return { images: [] as SearchResultImage[] }
        const data = (await res.json()) as NelthWebImageResponse
        return mapImageResponse(data, query)
      } catch {
        return { images: [] as SearchResultImage[] }
      }
    })()

    const [web, image] = await Promise.all([webPromise, imagePromise])
    return {
      ...web,
      images: image.images
    }
  }
}
