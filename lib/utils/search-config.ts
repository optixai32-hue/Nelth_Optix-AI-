/**
 * Search provider configuration utilities
 *
 * The single, authoritative search backend is NelthWeb
 * (https://nelthweb.space-z.ai). It handles both web search (with citations) and
 * image search. No API key / third-party provider is used anymore.
 */

import {
  resolveSearchProviderType,
  SearchProviderType
} from '@/lib/tools/search/providers'

/**
 * NelthWeb / DuckDuckGo is always available (no key required).
 */
export function isGeneralSearchProviderAvailable(): boolean {
  return true
}

export function getGeneralSearchProviderName(): string {
  const type = resolveSearchProviderType()
  return type === 'nelthweb' ? 'NelthWeb' : 'DuckDuckGo'
}

/**
 * NelthWeb supports image search via content_types: ['image'].
 */
export function supportsMultimediaContentTypes(): boolean {
  return true
}

export function getSearchTypeDescription(): string {
  return `Search type: general and optimized both use NelthWeb. Web results come with inline citations. When the user explicitly asks for images/pictures/photos, ALWAYS set content_types to ["image"] (or ["web","image"] to also get web links).`
}

export function getSearchToolDescription(): string {
  return `Search the web (and images) using NelthWeb. When the user wants images, set content_types:["image"] (or ["web","image"] for both). Otherwise use ["web"].`
}

export function getContentTypesGuidance(): string {
  return `- **Images / pictures / photos:**
  - When the user asks for images (e.g. "show me images of cats", "picture of the Eiffel Tower"), set content_types: ["image"].
  - To get both web results AND images, set content_types: ["web","image"].
  - Images are returned by NelthWeb and displayed in a gallery below the search results.
- **Normal web search:** use content_types: ["web"] (default).
- Both type="general" and type="optimized" support images.`
}

export function getSearchStrategyGuidance(): string {
  return `Search strategy:
- Use type="optimized" for most research queries (provides content snippets)
- Use type="general" with content_types:['image'] for image searches
- Fetch tool can be used optionally for deeper content analysis
- For comprehensive research: multiple searches + selective fetching`
}

/**
 * Returns the resolved search provider type.
 */
export function getGeneralSearchProviderType(): SearchProviderType | null {
  return resolveSearchProviderType()
}

