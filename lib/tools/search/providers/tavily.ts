import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'
import { withProxy } from './proxy'

const TAVILY_URL = 'https://api.tavily.com/search'

// Server-friendly web + image search via the Tavily API. Unlike the DuckDuckGo
// HTML scraper, Tavily is a real API that works reliably from Vercel's
// serverless (datacenter) IPs, which DuckDuckGo blocks.
export class TavilySearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = [],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    const apiKey = process.env.TAVILY_API_KEY
    this.validateApiKey(apiKey, 'TAVILY')

    const q = query.trim()
    if (!q) {
      return { results: [], images: [], query, number_of_results: 0 }
    }

    const wantImages = options?.content_types?.includes('image') ?? false

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query: q,
      search_depth: searchDepth,
      max_results: Math.max(maxResults, 5),
      include_domains: includeDomains,
      exclude_domains: excludeDomains,
      include_images: wantImages,
      include_image_descriptions: wantImages
    }

    const res = await fetch(TAVILY_URL, withProxy({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    }))
    if (!res.ok) {
      throw new Error(
        `Tavily search failed: ${res.status} ${await res.text().catch(() => '')}`
      )
    }

    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[]
      images?: (string | { url?: string; description?: string })[]
    }

    const results: SearchResultItem[] = (data.results ?? [])
      .map(r => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? ''
      }))
      .filter(r => r.url)

    const images: SearchResultImage[] = (data.images ?? [])
      .map(img => {
        if (typeof img === 'string') return { url: img, description: '' }
        return {
          url: img.url ?? '',
          description: img.description ?? '',
          ...(img.description ? { title: img.description } : {})
        }
      })
      .filter(i => i.url)

    return {
      results,
      images,
      query: q,
      number_of_results: results.length
    }
  }
}
