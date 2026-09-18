import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'

import { SearchProvider } from './base'
import { FourGetSearchProvider } from './fourget'

const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
}

const DDG_TIMEOUT_MS = 4000

function unescapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function decodeDuckDuckGoUrl(raw: string): string {
  if (!raw) return ''
  let url = raw.replace(/\\u002f/gi, '/').replace(/\\/g, '')
  if (url.startsWith('//')) {
    url = 'https:' + url
  }
  if (url.includes('duckduckgo.com/l/?') || url.includes('uddg=')) {
    try {
      const match = url.match(/[?&]uddg=([^&]+)/)
      if (match?.[1]) {
        return decodeURIComponent(match[1])
      }
    } catch {
      /* ignore */
    }
  }
  return url
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function parseDuckDuckGoLiteHtml(
  html: string,
  maxResults: number
): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const rowRegex =
    /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null

  while ((match = rowRegex.exec(html)) !== null) {
    const rawUrl = match[1]
    const rawTitle = match[2]
    const rawSnippet = match[3]

    const url = decodeDuckDuckGoUrl(rawUrl)
    const title = unescapeHtml(rawTitle)
    const snippet = unescapeHtml(rawSnippet)

    if (
      url &&
      isValidUrl(url) &&
      !url.includes('duckduckgo.com') &&
      !results.some(r => r.url === url)
    ) {
      results.push({
        title: title || url,
        url,
        content: snippet || title
      })
    }

    if (results.length >= maxResults) break
  }

  if (results.length === 0) {
    const genericLinkRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi
    while ((match = genericLinkRegex.exec(html)) !== null) {
      const rawUrl = match[1]
      const rawTitle = match[2]
      if (rawUrl.includes('uddg=')) {
        const url = decodeDuckDuckGoUrl(rawUrl)
        const title = unescapeHtml(rawTitle)
        if (
          url &&
          isValidUrl(url) &&
          !url.includes('duckduckgo.com') &&
          !results.some(r => r.url === url)
        ) {
          results.push({
            title: title || url,
            url,
            content: title
          })
        }
      }
      if (results.length >= maxResults) break
    }
  }

  return results
}

function parseDuckDuckGoHtml(
  html: string,
  maxResults: number
): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const linkRegex =
    /<a[^>]+class=['"][^'"]*result__url[^'"]*['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class=['"][^'"]*result__snippet[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1]
    const rawTitle = match[2]
    const rawSnippet = match[3]

    const url = decodeDuckDuckGoUrl(rawUrl)
    const title = unescapeHtml(rawTitle)
    const snippet = unescapeHtml(rawSnippet)

    if (
      url &&
      isValidUrl(url) &&
      !url.includes('duckduckgo.com') &&
      !results.some(r => r.url === url)
    ) {
      results.push({
        title: title || url,
        url,
        content: snippet || title
      })
    }

    if (results.length >= maxResults) break
  }

  return results
}

export class DuckDuckGoSearchProvider implements SearchProvider {
  private fourGetFallback = new FourGetSearchProvider()

  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs = DDG_TIMEOUT_MS
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...STEALTH_HEADERS,
          ...(init?.headers || {})
        },
        cache: 'no-store',
        signal: controller.signal
      })
      return res
    } finally {
      clearTimeout(timeout)
    }
  }

  private async searchLitePost(
    query: string,
    maxResults: number
  ): Promise<SearchResultItem[]> {
    try {
      const body = new URLSearchParams({
        q: query,
        kl: 'wt-wt'
      })
      const res = await this.fetchWithTimeout(
        'https://lite.duckduckgo.com/lite/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://lite.duckduckgo.com',
            Referer: 'https://lite.duckduckgo.com/'
          },
          body: body.toString()
        },
        3500
      )
      if (!res.ok) return []
      const html = await res.text()
      return parseDuckDuckGoLiteHtml(html, maxResults)
    } catch {
      return []
    }
  }

  private async searchHtmlGet(
    query: string,
    maxResults: number
  ): Promise<SearchResultItem[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`
      const res = await this.fetchWithTimeout(
        url,
        {
          headers: {
            Referer: 'https://duckduckgo.com/'
          }
        },
        3500
      )
      if (!res.ok) return []
      const html = await res.text()
      return parseDuckDuckGoHtml(html, maxResults)
    } catch {
      return []
    }
  }

  private async searchInstantAnswerApi(
    query: string
  ): Promise<SearchResultItem[]> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await this.fetchWithTimeout(url, {}, 2500)
      if (!res.ok) return []
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        Heading?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
      }
      const results: SearchResultItem[] = []
      if (data.AbstractText && data.AbstractURL && isValidUrl(data.AbstractURL)) {
        results.push({
          title: data.Heading || data.AbstractURL,
          url: data.AbstractURL,
          content: data.AbstractText
        })
      }
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.Text && topic.FirstURL && isValidUrl(topic.FirstURL)) {
            results.push({
              title: topic.Text.slice(0, 80),
              url: topic.FirstURL,
              content: topic.Text
            })
          }
        }
      }
      return results
    } catch {
      return []
    }
  }

  async search(
    query: string,
    maxResults = 10,
    searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = [],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    const contentTypes = options?.content_types || ['web']
    const wantsImages =
      contentTypes.includes('image') ||
      /\b(images?|photos?|pictures?)\b/i.test(query)
    const wantsWeb = contentTypes.includes('web') || !wantsImages

    let effectiveQuery = query.trim()
    if (includeDomains.length > 0) {
      effectiveQuery += ` ${includeDomains.map(d => `site:${d}`).join(' ')}`
    }
    if (excludeDomains.length > 0) {
      effectiveQuery += ` ${excludeDomains.map(d => `-site:${d}`).join(' ')}`
    }

    let webResults: SearchResultItem[] = []
    let images: SearchResultImage[] = []

    const tasks: Promise<void>[] = []

    if (wantsWeb) {
      tasks.push(
        (async () => {
          // 1. DuckDuckGo Lite POST (fastest & most reliable)
          try {
            webResults = await this.searchLitePost(effectiveQuery, maxResults)
          } catch (err) {
            console.warn('[DuckDuckGo] Lite POST search error:', err)
          }

          // 2. DuckDuckGo HTML GET fallback
          if (webResults.length === 0) {
            try {
              webResults = await this.searchHtmlGet(effectiveQuery, maxResults)
            } catch (err) {
              console.warn('[DuckDuckGo] HTML GET search error:', err)
            }
          }

          // 3. DuckDuckGo Instant Answer API fallback
          if (webResults.length === 0) {
            try {
              webResults = await this.searchInstantAnswerApi(effectiveQuery)
            } catch (err) {
              console.warn('[DuckDuckGo] Instant Answer API error:', err)
            }
          }

          // 4. 4get fallback if DuckDuckGo yielded 0 web results
          if (webResults.length === 0) {
            try {
              const fallback = await this.fourGetFallback.search(
                effectiveQuery,
                maxResults,
                searchDepth,
                includeDomains,
                excludeDomains,
                { type: options?.type, content_types: ['web'] }
              )
              if (fallback.results && fallback.results.length > 0) {
                webResults = fallback.results
              }
            } catch (fbErr) {
              console.warn('[DuckDuckGo] 4get fallback failed:', fbErr)
            }
          }
        })()
      )
    }

    if (wantsImages) {
      tasks.push(
        (async () => {
          try {
            const fallback = await this.fourGetFallback.search(
              effectiveQuery,
              20,
              searchDepth,
              includeDomains,
              excludeDomains,
              { type: options?.type, content_types: ['image'] }
            )
            if (fallback.images && fallback.images.length > 0) {
              images = fallback.images
            }
          } catch (imgErr) {
            console.warn('[DuckDuckGo] Image search fallback error:', imgErr)
          }
        })()
      )
    }

    await Promise.all(tasks)

    return {
      query,
      results: webResults,
      images,
      number_of_results: webResults.length
    }
  }
}
