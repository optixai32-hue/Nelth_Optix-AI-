/**
 * Search provider configuration utilities
 *
 * The search provider is resolved from SEARCH_API / available API keys
 * (Tavily, Brave) and falls back to DuckDuckGo (no key required) for local
 * development. DuckDuckGo's HTML scraper is blocked from serverless IPs, so
 * production deployments should configure Tavily or Brave.
 */

import { resolveSearchProviderType } from '@/lib/tools/search/providers'

/**
 * A provider is always available: DuckDuckGo works without a key locally, and
 * Tavily/Brave are used when their API key is present.
 */
export function isGeneralSearchProviderAvailable(): boolean {
  return true
}

export function getGeneralSearchProviderName(): string {
  const type = resolveSearchProviderType()
  if (type === 'tavily') return 'Tavily'
  if (type === 'brave') return 'Brave'
  if (type === 'searxng') return 'SearXNG'
  return 'DuckDuckGo'
}

/**
 * DuckDuckGo supports image search via content_types: ['image'].
 */
export function supportsMultimediaContentTypes(): boolean {
  return true
}

export function getSearchTypeDescription(): string {
  const type = resolveSearchProviderType()
  if (type === 'tavily') {
    return `Search type: general and optimized both use Tavily. Images are supported via content_types. When the user explicitly asks for images/pictures/photos, ALWAYS set content_types to ["image"] (or ["web","image"] to also get web links).`
  }
  if (type === 'brave') {
    return `Search type: general and optimized both use Brave Search. Images are supported via content_types. When the user explicitly asks for images/pictures/photos, ALWAYS set content_types to ["image"] (or ["web","image"] to also get web links).`
  }
  if (type === 'searxng') {
    return `Search type: general and optimized both use SearXNG (no API key required). Images are supported via content_types. When the user explicitly asks for images/pictures/photos, ALWAYS set content_types to ["image"] (or ["web","image"] to also get web links).`
  }
  return `Search type: general and optimized both use DuckDuckGo (no API key required). Images are fully supported via content_types. When the user explicitly asks for images/pictures/photos, ALWAYS set content_types to ["image"] (or ["web","image"] to also get web links).`
}

export function getSearchToolDescription(): string {
  const type = resolveSearchProviderType()
  const provider =
    type === 'tavily'
      ? 'Tavily'
      : type === 'brave'
        ? 'Brave'
        : type === 'searxng'
          ? 'SearXNG'
          : 'DuckDuckGo'
  return `Search the web (and images) using ${provider}. When the user wants images, set content_types:["image"] (or ["web","image"] for both). Otherwise use ["web"].`
}

export function getContentTypesGuidance(): string {
  return `- **Images / pictures / photos:**
  - When the user asks for images (e.g. "show me images of cats", "picture of the Eiffel Tower"), set content_types: ["image"].
  - To get both web results AND images, set content_types: ["web","image"].
  - Images are returned by DuckDuckGo and displayed in a gallery below the search results.
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
export function getGeneralSearchProviderType():
  | 'duckduckgo'
  | 'tavily'
  | 'brave'
  | 'searxng'
  | null {
  return resolveSearchProviderType()
}
