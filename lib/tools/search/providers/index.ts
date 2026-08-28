import { SearchProvider } from './base'
import { BraveSearchProvider } from './brave'
import { DuckDuckGoSearchProvider } from './duckduckgo'
import { SearXNGSearchProvider } from './searxng'
import { TavilySearchProvider } from './tavily'

export type SearchProviderType =
  | 'duckduckgo'
  | 'tavily'
  | 'brave'
  | 'searxng'
export const DEFAULT_PROVIDER: SearchProviderType = 'duckduckgo'

/**
 * Resolve which search provider to use.
 *
 * 1. Honor an explicit SEARCH_API value when set.
 * 2. Otherwise auto-detect from the API keys / URLs present in the environment:
 *    TAVILY_API_KEY -> tavily, BRAVE_SEARCH_API_KEY -> brave,
 *    SEARXNG_API_URL -> searxng. Nothing configured -> DuckDuckGo (local dev).
 *
 * DuckDuckGo's HTML scraper is blocked from serverless (Vercel) IPs, so
 * production should use Tavily, Brave, or a SearXNG instance.
 */
export function resolveSearchProviderType(): SearchProviderType {
  const configured = (process.env.SEARCH_API || '')
    .toLowerCase()
    .trim() as SearchProviderType
  if (
    configured === 'tavily' ||
    configured === 'brave' ||
    configured === 'duckduckgo' ||
    configured === 'searxng'
  ) {
    return configured
  }
  if (process.env.TAVILY_API_KEY) return 'tavily'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  if (process.env.SEARXNG_API_URL) return 'searxng'
  return 'duckduckgo'
}

function makeProvider(type: SearchProviderType): SearchProvider {
  switch (type) {
    case 'tavily':
      return new TavilySearchProvider()
    case 'brave':
      return new BraveSearchProvider()
    case 'searxng':
      return new SearXNGSearchProvider()
    case 'duckduckgo':
    default:
      return new DuckDuckGoSearchProvider()
  }
}

/**
 * Returns the resolved provider, with a graceful fallback to DuckDuckGo when the
 * primary provider errors or returns no results (e.g. a rate-limited SearXNG
 * instance, or a missing API key).
 */
export function createSearchProvider(
  _type?: SearchProviderType
): SearchProvider {
  const type = _type ?? resolveSearchProviderType()
  const primary = makeProvider(type)
  if (type === 'duckduckgo') return primary

  const fallback = new DuckDuckGoSearchProvider()
  return {
    async search(...args) {
      try {
        const result = await primary.search(...args)
        if (result.results.length > 0 || result.images.length > 0) {
          return result
        }
      } catch (error) {
        console.error(
          `Primary search provider (${type}) failed, falling back to DuckDuckGo:`,
          error
        )
      }
      return fallback.search(...args)
    }
  }
}

export {
  BraveSearchProvider,
  DuckDuckGoSearchProvider,
  SearXNGSearchProvider,
  TavilySearchProvider
}
export type { SearchProvider }
