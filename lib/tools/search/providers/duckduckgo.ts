import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

// Real web + image search via DuckDuckGo (no API key required).
//
// Two DuckDuckGo sources are combined:
//   1. The HTML endpoint (html.duckduckgo.com) which returns actual ranked
//      web results (title + snippet + URL). This is a genuine web search.
//   2. The Instant Answer API (api.duckduckgo.com) which adds a short
//      abstract for well-known topics.
//   3. The i.js endpoint for image search (requires a short-lived vqd token).
//
// The HTML endpoint intermittently serves an anti-bot decoy page, so requests
// are retried a few times and only "real" browser headers are sent.

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const DDG_READER_URL = 'https://r.jina.ai/http://html.duckduckgo.com/html/'
const DDG_IA_URL =
  'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&no_redirect=1'
const DDG_HOME = 'https://duckduckgo.com/'
const DDG_IMG_URL = 'https://duckduckgo.com/i.js'

// Full browser-like headers: DuckDuckGo returns 403 / decoy pages when these
// are missing, and 200 with real results when they are present.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
  Referer: 'https://duckduckgo.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin'
}

const MAX_RESULTS = 10
const MAX_IMAGE_RESULTS = 6

interface WebResult {
  title: string
  url: string
  snippet: string
}

interface ImageResult {
  title: string
  url: string // source page URL
  image: string // direct image URL
  thumbnail: string
  source: string // source domain / site name
  width?: number
  height?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Strip HTML tags and decode the handful of entities DuckDuckGo emits.
function cleanText(input: string): string {
  return input
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

// DuckDuckGo wraps result links as: //duckduckgo.com/l/?uddg=<encoded>&rut=...
function unwrapUrl(href: string): string {
  const decodedHref = href.replace(/&amp;/g, '&')
  const match = decodedHref.match(/[?&]uddg=([^&]+)/)
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      // fall through
    }
  }
  if (decodedHref.startsWith('//')) return `https:${decodedHref}`
  return decodedHref
}

// Parse the DuckDuckGo HTML results page. Titles and snippets are matched by
// position so a result missing a snippet does not misalign the rest.
function parseHtmlResults(html: string, limit: number): WebResult[] {
  const linkRe =
    /<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe =
    /<a\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const snippets: { index: number; text: string }[] = []
  let sm: RegExpExecArray | null
  while ((sm = snippetRe.exec(html)) !== null) {
    snippets.push({ index: sm.index, text: cleanText(sm[1]) })
  }

  const links: { index: number; url: string; title: string }[] = []
  let lm: RegExpExecArray | null
  while ((lm = linkRe.exec(html)) !== null) {
    const title = cleanText(lm[2])
    if (title) links.push({ index: lm.index, url: unwrapUrl(lm[1]), title })
  }

  const results: WebResult[] = []
  for (let i = 0; i < links.length && results.length < limit; i++) {
    const link = links[i]
    const nextIndex = links[i + 1]?.index ?? Infinity
    // Snippet belonging to this result sits between this link and the next.
    const snippet =
      snippets.find(s => s.index > link.index && s.index < nextIndex)?.text ??
      ''
    results.push({ title: link.title, url: link.url, snippet })
  }
  return results
}

function parseReaderResults(markdown: string, limit: number): WebResult[] {
  const resultRe = /\n## \[([^\]]+)\]\(([^)]+)\)\n([\s\S]*?)(?=\n## |$)/g
  const results: WebResult[] = []
  let match: RegExpExecArray | null

  while ((match = resultRe.exec(markdown)) !== null && results.length < limit) {
    const url = unwrapUrl(match[2])
    const title = cleanText(match[1])
    const snippet = cleanText(
      match[3]
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/[*_`>#]/g, '')
    )
    if (!title || !url || url.includes('duckduckgo.com/html')) continue
    results.push({ title, url, snippet })
  }
  return results
}

async function ddgReaderSearch(
  query: string,
  limit = MAX_RESULTS
): Promise<WebResult[]> {
  try {
    const res = await fetch(
      `${DDG_READER_URL}?q=${encodeURIComponent(query)}&kl=wt-wt`,
      { signal: AbortSignal.timeout(12000) }
    )
    if (!res.ok) return []
    return parseReaderResults(await res.text(), limit)
  } catch {
    return []
  }
}

// Query the DuckDuckGo HTML endpoint, retrying past anti-bot decoy pages.
async function ddgHtmlSearch(
  query: string,
  limit = MAX_RESULTS
): Promise<WebResult[]> {
  const url = `${DDG_HTML_URL}?q=${encodeURIComponent(query)}&kl=wt-wt`
  const attempts = 3
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(6000)
      })
      if (res.ok) {
        const html = await res.text()
        const results = parseHtmlResults(html, limit)
        if (results.length > 0) return results
      }
    } catch {
      // network error / timeout — retry
    }
    if (attempt < attempts - 1) await sleep(300 * (attempt + 1))
  }
  const readerResults = await ddgReaderSearch(query, limit)
  return readerResults.length ? readerResults : ddgInstantResults(query, limit)
}

interface InstantAnswerTopic {
  Text?: string
  FirstURL?: string
  Topics?: InstantAnswerTopic[]
}

async function ddgInstantResults(
  query: string,
  limit = MAX_RESULTS
): Promise<WebResult[]> {
  try {
    const url = `${DDG_IA_URL}&q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }
    })
    if (!res.ok) return []

    const data = (await res.json()) as {
      AbstractText?: string
      AbstractSource?: string
      AbstractURL?: string
      RelatedTopics?: InstantAnswerTopic[]
    }
    const results: WebResult[] = []
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || query,
        url: data.AbstractURL,
        snippet: data.AbstractText
      })
    }

    const topics = (data.RelatedTopics ?? []).flatMap(topic =>
      topic.Topics?.length ? topic.Topics : [topic]
    )
    for (const topic of topics) {
      if (!topic.Text || !topic.FirstURL) continue
      results.push({
        title: topic.Text.split(' - ')[0] || query,
        url: topic.FirstURL,
        snippet: topic.Text
      })
      if (results.length >= limit) break
    }
    return results
  } catch {
    return []
  }
}

// Query the DuckDuckGo Instant Answer API for a short abstract.
async function ddgInstantAnswer(query: string): Promise<string> {
  try {
    const url = `${DDG_IA_URL}&q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }
    })
    if (!res.ok) return ''
    const data = (await res.json()) as {
      AbstractText?: string
      AbstractSource?: string
      RelatedTopics?: { Text?: string }[]
    }
    if (data.AbstractText) {
      const src = data.AbstractSource ? ` (${data.AbstractSource})` : ''
      return `${data.AbstractText}${src}`
    }
    if (Array.isArray(data.RelatedTopics)) {
      const first = data.RelatedTopics.find(t => t?.Text)?.Text
      if (first) return first
    }
    return ''
  } catch {
    return ''
  }
}

// Extract the vqd token DuckDuckGo needs for its i.js image endpoint.
async function getVqd(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${DDG_HOME}?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(6000)
      }
    )
    if (!res.ok) return null
    const html = await res.text()
    const patterns = [
      /vqd=["']([^"']+)["']/,
      /vqd=([0-9-]+)&/,
      /vqd["']?\s*[:=]\s*["']([^"']+)["']/
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m && m[1]) return m[1]
    }
    return null
  } catch {
    return null
  }
}

async function ddgImageSearch(
  query: string,
  limit = MAX_IMAGE_RESULTS
): Promise<ImageResult[]> {
  const q = query.trim()
  if (!q) return []

  const vqd = await getVqd(q)
  if (!vqd) return []

  const url =
    `${DDG_IMG_URL}?l=wt-wt&o=json&q=${encodeURIComponent(q)}` +
    `&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1&s=0`

  const attempts = 2
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: AbortSignal.timeout(6000)
      })
      if (res.ok) {
        const data = (await res.json()) as {
          results?: {
            title?: string
            url?: string
            image?: string
            thumbnail?: string
            source?: string
            width?: number
            height?: number
          }[]
        }
        const raw = Array.isArray(data.results) ? data.results : []
        const seen = new Set<string>()
        const results: ImageResult[] = []
        for (const r of raw) {
          const image = typeof r.image === 'string' ? r.image : ''
          const page = typeof r.url === 'string' ? r.url : ''
          if (!image || !page || seen.has(image)) continue
          seen.add(image)
          results.push({
            title: typeof r.title === 'string' ? cleanText(r.title) : '',
            url: page,
            image,
            thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : image,
            source: typeof r.source === 'string' ? r.source : '',
            width: typeof r.width === 'number' ? r.width : undefined,
            height: typeof r.height === 'number' ? r.height : undefined
          })
          if (results.length >= limit) break
        }
        return results
      }
    } catch {
      // network error / timeout — retry
    }
    if (attempt < attempts - 1) await sleep(300 * (attempt + 1))
  }
  return []
}

export class DuckDuckGoSearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = MAX_RESULTS,
    _searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = [],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    const q = query.trim()
    const limit = Math.max(maxResults, MAX_RESULTS)
    const contentTypes = options?.content_types || ['web']

    if (!q) {
      return { results: [], images: [], query, number_of_results: 0 }
    }

    const wantImages = contentTypes.includes('image')
    // Always fetch web results alongside images so the answer still has
    // citable sources; image-only requests simply add the gallery.
    const wantWeb = contentTypes.includes('web') || wantImages

    const [webResults, imageResults] = await Promise.all([
      wantWeb ? ddgHtmlSearch(q, limit) : Promise.resolve([]),
      wantImages ? ddgImageSearch(q, MAX_IMAGE_RESULTS) : Promise.resolve([])
    ])

    const filteredResults = (webResults ?? []).filter(r => {
      const domain = (() => {
        try {
          return new URL(r.url).hostname
        } catch {
          return ''
        }
      })()
      const inInclude =
        includeDomains.length === 0 ||
        includeDomains.some(d => domain.includes(d))
      const inExclude =
        excludeDomains.length > 0 &&
        excludeDomains.some(d => domain.includes(d))
      return inInclude && !inExclude
    })

    const results = filteredResults.map(r => ({
      title: r.title,
      url: r.url,
      content: r.snippet
    }))

    const images = (imageResults ?? []).map(r => ({
      url: r.image,
      description: r.title,
      ...(r.title ? { title: r.title } : {}),
      ...(r.url ? { sourceUrl: r.url } : {})
    }))

    return {
      results,
      images,
      query: q,
      number_of_results: results.length
    }
  }
}
