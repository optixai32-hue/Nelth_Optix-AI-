import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

// Search via SearXNG instances. No API key required. Each instance is tried in
// order until one returns results, so a rate-limited (HTTP 429) or down
// instance automatically falls through to the next. Public instances are often
// rate-limited, so a list of fallbacks is strongly recommended.
//
// Configure a custom list with SEARXNG_API_URL (comma-separated). When unset, a
// curated list from https://searx.space is used (search.catboy.house first).
const DEFAULT_INSTANCES = [
  'https://search.catboy.house',
  'https://baresearch.org',
  'https://etsi.me',
  'https://failsearx.culturanerd.it',
  'https://find.xenorio.xyz',
  'https://grep.vim.wtf',
  'https://kantan.cat',
  'https://libresearch.space',
  'https://opnxng.com',
  'https://paulgo.io',
  'https://priv.au',
  'https://sear.lurx.net',
  'https://search.2b9t.xyz',
  'https://search.anoni.net',
  'https://search.bladerunn.in',
  'https://search.chocolatemoo53.com',
  'https://search.ctq.ro',
  'https://search.einfachzocken.eu'
]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class SearXNGSearchProvider extends BaseSearchProvider {
  private getInstances(): string[] {
    const env = (process.env.SEARXNG_API_URL || '')
      .split(',')
      .map(s => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
    return env.length ? env : DEFAULT_INSTANCES
  }

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
    const q = query.trim()
    if (!q) {
      return { results: [], images: [], query, number_of_results: 0 }
    }

    const wantImages = options?.content_types?.includes('image') ?? false
    const instances = this.getInstances()
    let lastError: unknown

    for (const base of instances) {
      try {
        const result = await this.searchOn(
          base,
          q,
          maxResults,
          wantImages,
          includeDomains
        )
        if (result.results.length > 0 || result.images.length > 0) {
          return result
        }
      } catch (error) {
        lastError = error
      }
    }

    if (lastError) {
      console.error('All SearXNG instances failed:', lastError)
    }
    return { results: [], images: [], query: q, number_of_results: 0 }
  }

  private async searchOn(
    base: string,
    q: string,
    maxResults: number,
    wantImages: boolean,
    includeDomains: string[]
  ): Promise<SearchResults> {
    const params = new URLSearchParams({ q })
    if (wantImages) params.set('categories', 'images')

    const url = `${base}/search?${params.toString()}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/html' },
      signal: AbortSignal.timeout(10000)
    })

    if (res.status === 429) {
      throw new Error(`${base} returned 429 (rate limited)`)
    }
    if (!res.ok) {
      throw new Error(`${base} search failed: ${res.status}`)
    }

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as {
        results?: {
          url?: string
          title?: string
          content?: string
          img_src?: string
        }[]
      }
      return this.shape(data.results ?? [], wantImages, q)
    }

    const html = await res.text()
    return this.parseHtml(html, wantImages, q)
  }

  private shape(
    raw: { url?: string; title?: string; content?: string; img_src?: string }[],
    wantImages: boolean,
    query: string
  ): SearchResults {
    const items = raw
      .map(r => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? '',
        imgSrc: r.img_src ?? ''
      }))
      .filter(r => r.url)

    if (wantImages) {
      const images: SearchResultImage[] = items
        .filter(r => r.imgSrc)
        .map(r => ({
          url: r.imgSrc,
          description: r.title,
          ...(r.title ? { title: r.title } : {}),
          ...(r.url ? { sourceUrl: r.url } : {})
        }))
      return { results: [], images, query, number_of_results: images.length }
    }

    const results: SearchResultItem[] = items.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content
    }))
    return { results, images: [], query, number_of_results: results.length }
  }

  private parseHtml(
    html: string,
    wantImages: boolean,
    query: string
  ): SearchResults {
    const linkRe =
      /<a\b[^>]*class="(?:result-link|url_header)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe = /<p\b[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/g

    const clean = (s: string) =>
      s
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()

    const snippets: { index: number; text: string }[] = []
    let sm: RegExpExecArray | null
    while ((sm = snippetRe.exec(html)) !== null) {
      snippets.push({ index: sm.index, text: clean(sm[1]) })
    }

    const links: { index: number; url: string; title: string }[] = []
    let lm: RegExpExecArray | null
    while ((lm = linkRe.exec(html)) !== null) {
      const title = clean(lm[2])
      if (title) links.push({ index: lm.index, url: lm[1], title })
    }

    const results: SearchResultItem[] = []
    for (let i = 0; i < links.length && results.length < 10; i++) {
      const link = links[i]
      const nextIndex = links[i + 1]?.index ?? Infinity
      const snippet =
        snippets.find(s => s.index > link.index && s.index < nextIndex)?.text ??
        ''
      results.push({ title: link.title, url: link.url, content: snippet })
    }
    return { results, images: [], query, number_of_results: results.length }
  }
}
