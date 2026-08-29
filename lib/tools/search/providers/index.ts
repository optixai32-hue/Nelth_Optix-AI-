import { SearchProvider } from './base'
import { NelthWebSearchProvider } from './nelthweb'

export type SearchProviderType = 'nelthweb'

/**
 * The only search backend is now NelthWeb. This kept the previous resolver
 * signature so the rest of the app (search.ts, search-config.ts) is unaffected.
 */
export function resolveSearchProviderType(): SearchProviderType {
  return 'nelthweb'
}

/**
 * Always returns the NelthWeb search provider. No fallback chain — NelthWeb is the
 * single source of truth for web + image search.
 */
export function createSearchProvider(
  _type?: SearchProviderType
): SearchProvider {
  return new NelthWebSearchProvider()
}

export { NelthWebSearchProvider }
export type { SearchProvider }
