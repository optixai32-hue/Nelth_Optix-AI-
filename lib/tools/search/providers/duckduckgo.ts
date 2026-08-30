import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'

import { SearchProvider } from './base'
import { NelthWebSearchProvider } from './nelthweb'

/**
 * Realistic browser stealth headers to bypass DuckDuckGo bot checks on Vercel.
 */
const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1'
}

const DDG_TIMEOUT_MS = 6000

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

/**
 * Parses DuckDuckGo HTML Lite results.
 */
function parseDuckDuckGoLiteHtml(html: string, maxResults: number): SearchResultItem[] {
  const results: SearchResultItem[] = []
  // Matches result links in Lite table
  const rowRegex = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null

  while ((match = rowRegex.exec(html)) !== null) {
    const rawUrl = match[1]
    const rawTitle = match[2]
    const rawSnippet = match[3]

    const url = decodeDuckDuckGoUrl(rawUrl)
    const title = unescapeHtml(rawTitle)
    const snippet = unescapeHtml(rawSnippet)

    if (url && isValidUrl(url) && !url.includes('duckduckgo.com') && !results.some(r => r.url === url)) {
      results.push({
        title: title || url,
        url,
        content: snippet || title
      })
    }

    if (results.length >= maxResults) break
  }

  // Fallback pattern if class names differed
  if (results.length === 0) {
    const genericLinkRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi
    while ((match = genericLinkRegex.exec(html)) !== null) {
      const rawUrl = match[1]
      const rawTitle = match[2]
      if (rawUrl.includes('uddg=')) {
        const url = decodeDuckDuckGoUrl(rawUrl)
        const title = unescapeHtml(rawTitle)
        if (url && isValidUrl(url) && !url.includes('duckduckgo.com') && !results.some(r => r.url === url)) {
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

/**
 * Parses DuckDuckGo standard HTML results.
 */
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const linkRegex = /<a[^>]+class=['"][^'"]*result__url[^'"]*['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class=['"][^'"]*result__snippet[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1]
    const rawTitle = match[2]
    const rawSnippet = match[3]

    const url = decodeDuckDuckGoUrl(rawUrl)
    const title = unescapeHtml(rawTitle)
    const snippet = unescapeHtml(rawSnippet)

    if (url && isValidUrl(url) && !url.includes('duckduckgo.com') && !results.some(r => r.url === url)) {
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
  private nelthWebFallback = new NelthWebSearchProvider()

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS)
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
      clearTimeout(timeout)
      return res
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }
  }

  private async getVqdToken(query: string): Promise<string | null> {
    try {
      const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
      const res = await this.fetchWithTimeout(url)
      if (!res.ok) return null
      const text = await res.text()
      const match = text.match(/vqd=['"]?([^'"&\s>]+)['"]?/)
      if (match?.[1]) return match[1]
      const headerVqd = res.headers.get('x-vqd-4')
      if (headerVqd) return headerVqd
      return null
    } catch {
      return null
    }
  }

  private async searchImages(query: string, vqd: string, maxResults = 8): Promise<SearchResultImage[]> {
    try {
      const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&o=json&p=1&s=0&u=bing&f=,,,&l=wt-wt`
      const res = await this.fetchWithTimeout(url, {
        headers: {
          Referer: 'https://duckduckgo.com/'
        }
      })
      if (!res.ok) return []
      const data = (await res.json()) as {
        results?: Array<{ image?: string; title?: string; url?: string }>
      }
      if (!data.results || !Array.isArray(data.results)) return []
      return data.results
        .slice(0, maxResults)
        .map(item => ({
          url: item.image || item.url || '',
          description: item.title || query
        }))
        .filter(img => isValidUrl(img.url))
    } catch {
      return []
    }
  }

  private async searchLitePost(query: string, maxResults: number): Promise<SearchResultItem[]> {
    try {
      const body = new URLSearchParams({
        q: query,
        kl: 'wt-wt'
      })
      const res = await this.fetchWithTimeout('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://lite.duckduckgo.com',
          Referer: 'https://lite.duckduckgo.com/'
        },
        body: body.toString()
      })
      if (!res.ok) return []
      const html = await res.text()
      return parseDuckDuckGoLiteHtml(html, maxResults)
    } catch {
      return []
    }
  }

  private async searchHtmlGet(query: string, maxResults: number): Promise<SearchResultItem[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`
      const res = await this.fetchWithTimeout(url, {
        headers: {
          Referer: 'https://duckduckgo.com/'
        }
      })
      if (!res.ok) return []
      const html = await res.text()
      return parseDuckDuckGoHtml(html, maxResults)
    } catch {
      return []
    }
  }

  private async searchInstantAnswerApi(query: string): Promise<SearchResultItem[]> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await this.fetchWithTimeout(url)
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
    const wantsImages =
      options?.content_types?.includes('image') ||
      /\b(images?|photos?|pictures?)\b/i.test(query)

    console.log(`[DuckDuckGo] Searching for: "${query}" (wantsImages=${wantsImages})`)

    let webResults: SearchResultItem[] = []
    let images: SearchResultImage[] = []

    // 1. Try DuckDuckGo Lite POST (most reliable on serverless)
    try {
      webResults = await this.searchLitePost(query, maxResults)
    } catch (err) {
      console.warn('[DuckDuckGo] Lite POST search error:', err)
    }

    // 2. If Lite POST returned 0, try HTML GET endpoint
    if (webResults.length === 0) {
      try {
        webResults = await this.searchHtmlGet(query, maxResults)
      } catch (err) {
        console.warn('[DuckDuckGo] HTML GET search error:', err)
      }
    }

    // 3. If still 0, try DuckDuckGo Instant Answer API
    if (webResults.length === 0) {
      try {
        webResults = await this.searchInstantAnswerApi(query)
      } catch (err) {
        console.warn('[DuckDuckGo] Instant Answer API error:', err)
      }
    }

    // 3. If images are needed, attempt image search via vqd token
    if (wantsImages) {
      try {
        const vqd = await this.getVqdToken(query)
        if (vqd) {
          images = await this.searchImages(query, vqd, 8)
        }
      } catch (imgErr) {
        console.warn('[DuckDuckGo] Image search error:', imgErr)
      }
    }

    // 4. VERCEL RESILIENCE: If DuckDuckGo was blocked (returned 0 results),
    // automatically fall back to NelthWeb so the chat NEVER fails or errors!
    if (webResults.length === 0) {
      console.warn(
        '[DuckDuckGo] 0 results from DuckDuckGo on this environment; falling back to NelthWeb...'
      )
      return this.nelthWebFallback.search(
        query,
        maxResults,
        searchDepth,
        includeDomains,
        excludeDomains,
        options
      )
    }

    // If web results succeeded but images were requested and empty, fetch images from fallback
    if (wantsImages && images.length === 0) {
      try {
        const fallbackRes = await this.nelthWebFallback.search(
          query,
          maxResults,
          searchDepth,
          includeDomains,
          excludeDomains,
          options
        )
        if (fallbackRes.images && fallbackRes.images.length > 0) {
          images = fallbackRes.images
        }
      } catch {
        /* ignore image fallback failure */
      }
    }

    return {
      results: webResults,
      images,
      query,
      number_of_results: webResults.length
    }
  }
}
