import { SearchProvider } from './base'
import { BraveSearchProvider } from './brave'
import { DuckDuckGoSearchProvider } from './duckduckgo'
import { TavilySearchProvider } from './tavily'

export type SearchProviderType = 'duckduckgo' | 'tavily' | 'brave'
export const DEFAULT_PROVIDER: SearchProviderType = 'duckduckgo'

/**
 * Resolve which search provider to use.
 *
 * 1. Honor an explicit SEARCH_API value when set.
 * 2. Otherwise auto-detect from the API keys present in the environment. This is
 *    what makes production (Vercel) work out of the box: if TAVILY_API_KEY or
 *    BRAVE_SEARCH_API_KEY is configured there, we use it instead of the
 *    DuckDuckGo HTML scraper — which DuckDuckGo blocks from serverless
 *    (datacenter) IPs, causing empty results.
 * 3. Fall back to DuckDuckGo (no key required) for local development.
 */
export function resolveSearchProviderType(): SearchProviderType {
  const configured = (process.env.SEARCH_API || '')
    .toLowerCase()
    .trim() as SearchProviderType
  if (
    configured === 'tavily' ||
    configured === 'brave' ||
    configured === 'duckduckgo'
  ) {
    return configured
  }
  if (process.env.TAVILY_API_KEY) return 'tavily'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  return 'duckduckgo'
}

export function createSearchProvider(
  _type?: SearchProviderType
): SearchProvider {
  const type = _type ?? resolveSearchProviderType()
  switch (type) {
    case 'tavily':
      return new TavilySearchProvider()
    case 'brave':
      return new BraveSearchProvider()
    case 'duckduckgo':
    default:
      return new DuckDuckGoSearchProvider()
  }
}

export {
  BraveSearchProvider,
  DuckDuckGoSearchProvider,
  TavilySearchProvider
}
export type { SearchProvider }
