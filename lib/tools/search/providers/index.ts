import { SearchProvider } from './base'
import { FourGetSearchProvider } from './fourget'

export type SearchProviderType = '4get' | 'fourget'

/**
 * Resolves the configured search provider from environment variables.
 * Defaults to '4get' (https://4get.sudovanilla.org).
 */
export function resolveSearchProviderType(): SearchProviderType {
  return '4get'
}

/**
 * Creates the search provider (4get).
 */
export function createSearchProvider(
  _type?: SearchProviderType
): SearchProvider {
  return new FourGetSearchProvider()
}

export { FourGetSearchProvider }
export type { SearchProvider }

