import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

const BRAVE_WEB_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_IMAGES_URL = 'https://api.search.brave.com/res/v1/images/search'

// Server-friendly web + image search via the Brave Search API. Works reliably
// from Vercel's serverless IPs, unlike the DuckDuckGo HTML scraper.
export class BraveSearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    _searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = [],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY
    this.validateApiKey(apiKey, 'BRAVE')

    const q = query.trim()
    if (!q) {
      return { results: [], images: [], query, number_of_results: 0 }
    }

    const wantImages = options?.content_types?.includes('image') ?? false
    const count = Math.min(Math.max(maxResults, 5), 20)

    const headers = {
      'X-Subscription-Token': apiKey as string,
      Accept: 'application/json'
    }

    const webParams = new URLSearchParams({ q, count: String(count) })
    if (includeDomains.length) {
      webParams.set('site', includeDomains.join(' OR '))
    }
    if (excludeDomains.length) {
      webParams.set('exclude_site', excludeDomains.join(' OR '))
    }

    const [webData, imageData] = await Promise.all([
      fetch(`${BRAVE_WEB_URL}?${webParams.toString()}`, {
        headers,
        signal: AbortSignal.timeout(15000)
      }).then(r => {
        if (!r.ok) throw new Error(`Brave web search failed: ${r.status}`)
        return r.json() as Promise<{
          web?: { results?: { title?: string; url?: string; description?: string }[] }
        }>
      }),
      wantImages
        ? fetch(`${BRAVE_IMAGES_URL}?${new URLSearchParams({ q, count: String(count) }).toString()}`, {
            headers,
            signal: AbortSignal.timeout(15000)
          }).then(r => {
            if (!r.ok) throw new Error(`Brave image search failed: ${r.status}`)
            return r.json() as Promise<{
              results?: { url?: string; title?: string; source?: string }[]
            }>
          })
        : Promise.resolve(undefined)
    ])

    const results: SearchResultItem[] = (webData.web?.results ?? [])
      .map(r => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.description ?? ''
      }))
      .filter(r => r.url)

    const images: SearchResultImage[] = (imageData?.results ?? [])
      .map(r => ({
        url: r.url ?? '',
        description: r.title ?? '',
        ...(r.title ? { title: r.title } : {}),
        ...(r.source ? { sourceUrl: r.source } : {})
      }))
      .filter(i => i.url)

    return {
      results,
      images,
      query: q,
      number_of_results: results.length
    }
  }
}
