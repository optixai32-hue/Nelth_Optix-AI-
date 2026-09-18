import { SearchProvider } from './base'
import { DuckDuckGoSearchProvider } from './duckduckgo'
import { FourGetSearchProvider } from './fourget'

export type SearchProviderType = 'duckduckgo' | 'ddg' | '4get' | 'fourget'

/**
 * Resolves the configured search provider from environment variables.
 * Defaults to 'duckduckgo' with automatic 4get fallback.
 */
export function resolveSearchProviderType(): SearchProviderType {
  const envType = (process.env.SEARCH_API || '').toLowerCase().trim()
  if (envType === '4get' || envType === 'fourget') {
    return '4get'
  }
  return 'duckduckgo'
}

/**
 * Creates the search provider.
 */
export function createSearchProvider(
  type?: SearchProviderType
): SearchProvider {
  const resolved = type ?? resolveSearchProviderType()
  if (resolved === '4get' || resolved === 'fourget') {
    return new FourGetSearchProvider()
  }
  return new DuckDuckGoSearchProvider()
}

export { DuckDuckGoSearchProvider, FourGetSearchProvider }
export type { SearchProvider }

