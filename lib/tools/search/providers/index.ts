import { SearchProvider } from './base'
import { DuckDuckGoSearchProvider } from './duckduckgo'
import { NelthWebSearchProvider } from './nelthweb'

export type SearchProviderType = 'duckduckgo' | 'nelthweb'

/**
 * Resolves the configured search provider from environment variables.
 * Defaults to 'duckduckgo'.
 */
export function resolveSearchProviderType(): SearchProviderType {
  const configured = (
    process.env.SEARCH_PROVIDER ||
    process.env.SEARCH_API ||
    ''
  ).toLowerCase()
  if (configured === 'nelthweb') {
    return 'nelthweb'
  }
  return 'duckduckgo'
}

/**
 * Creates the search provider based on configuration or explicit type.
 */
export function createSearchProvider(
  type?: SearchProviderType
): SearchProvider {
  const providerType = type ?? resolveSearchProviderType()
  if (providerType === 'nelthweb') {
    return new NelthWebSearchProvider()
  }
  return new DuckDuckGoSearchProvider()
}

export { DuckDuckGoSearchProvider, NelthWebSearchProvider }
export type { SearchProvider }

