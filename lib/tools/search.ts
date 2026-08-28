import { type JSONValue, tool, UIToolInvocation } from 'ai'

import { getSearchSchemaForModel } from '@/lib/schema/search'
import { SearchResults } from '@/lib/types'
import { getSearchToolDescription } from '@/lib/utils/search-config'
import { logToolPayload } from '@/lib/utils/usage-logging'

import {
  createSearchProvider,
  resolveSearchProviderType
} from './search/providers'

/**
 * Creates a search tool with the appropriate schema for the given model.
 */
export function createSearchTool(fullModel: string) {
  return tool({
    description: getSearchToolDescription(),
    inputSchema: getSearchSchemaForModel(fullModel),
    async *execute(
      {
        query,
        type = 'optimized',
        content_types = ['web'],
        max_results = 20,
        search_depth = 'basic', // Default for standard schema
        include_domains = [],
        exclude_domains = []
      },
      context
    ) {
      // Yield initial searching state
      yield {
        state: 'searching' as const,
        query
      }
      // Ensure max_results is at least 10
      const minResults = 10
      const effectiveMaxResults = Math.max(
        max_results || minResults,
        minResults
      )
      const effectiveSearchDepth = search_depth as 'basic' | 'advanced'

      // Use the original query as is - any provider-specific handling will be done in the provider
      const filledQuery = query
      let searchResult: SearchResults

      // Detect image intent in the query so image search is performed even
      // when the model does not explicitly set content_types. The configured
      // DuckDuckGo provider supports image results. Covers English and French.
      const IMAGE_INTENT_RE =
        /\b(images?|pictures?|photos?|photograph|illustration|wallpaper|gifs?|meme|drawing|show me|visuel(?:le)?|dessin|aperçu|montre[ -]?moi)\b/i
      const requestedContentTypes = Array.isArray(content_types)
        ? [...content_types]
        : ['web']
      if (
        !requestedContentTypes.includes('image') &&
        IMAGE_INTENT_RE.test(filledQuery)
      ) {
        requestedContentTypes.push('image')
        if (!requestedContentTypes.includes('web')) {
          requestedContentTypes.push('web')
        }
      }

      // The provider is resolved from SEARCH_API / available API keys (Tavily,
      // Brave) and falls back to DuckDuckGo for local dev.
      console.log(
        `Using search API: ${resolveSearchProviderType()}, Type: ${type}, Search Depth: ${effectiveSearchDepth}`
      )

      try {
        const searchProvider = createSearchProvider()

        searchResult = await searchProvider.search(
          filledQuery,
          effectiveMaxResults,
          effectiveSearchDepth,
          include_domains,
          exclude_domains,
          {
            type: type as 'general' | 'optimized',
            content_types: requestedContentTypes as Array<
              'web' | 'video' | 'image' | 'news'
            >
          }
        )
      } catch (error) {
        console.error('Search API error:', error)
        // Re-throw the error to let AI SDK handle it properly
        throw error instanceof Error ? error : new Error('Unknown search error')
      }

      // No citationMap is attached: it fully duplicated `results`
      // (citationMap[N] === results[N-1]). The UI derives citations from
      // `results` by index instead (see extractCitationMaps), with a fallback
      // for older persisted messages that still carry citationMap.

      // Add toolCallId from context
      if (context?.toolCallId) {
        searchResult.toolCallId = context.toolCallId
      }

      console.log('completed search')

      logToolPayload('search', query, {
        results: searchResult.results,
        images: searchResult.images
      })

      // Yield final results with complete state
      yield {
        state: 'complete' as const,
        ...searchResult
      }
    },
    // Trim the model-facing tool result: citationMap fully duplicates
    // `results` (dropped defensively for older persisted output) and state is
    // a streaming marker. images MUST stay — getImageSpecPrompt instructs the
    // model to embed URLs verbatim from this array. toolCallId MUST stay: the
    // prompt cites as [number](#toolCallId), so the model reads the id from
    // here.
    toModelOutput: ({ output }) => {
      if (!output || typeof output !== 'object') {
        return { type: 'json', value: (output ?? null) as JSONValue }
      }
      const modelView: Record<string, unknown> = {
        ...(output as Record<string, unknown>)
      }
      delete modelView.citationMap
      delete modelView.state
      return { type: 'json', value: modelView as JSONValue }
    }
  })
}

// Default export for backward compatibility, using a default model
export const searchTool = createSearchTool('openai:gpt-4o-mini')

// Export type for UI tool invocation
export type SearchUIToolInvocation = UIToolInvocation<typeof searchTool>

export async function search(
  query: string,
  maxResults: number = 10,
  searchDepth: 'basic' | 'advanced' = 'basic',
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const result = await searchTool.execute?.(
    {
      query,
      type: 'general',
      content_types: ['web'],
      max_results: maxResults,
      search_depth: searchDepth,
      include_domains: includeDomains,
      exclude_domains: excludeDomains
    },
    {
      toolCallId: 'search',
      messages: []
    }
  )

  if (!result) {
    return { results: [], images: [], query, number_of_results: 0 }
  }

  // Handle AsyncIterable case
  if (Symbol.asyncIterator in result) {
    // Collect all results from the async iterable
    let searchResults: SearchResults | null = null
    for await (const chunk of result) {
      // Only assign when we get the complete result
      if ('state' in chunk && chunk.state === 'complete') {
        const { state, ...rest } = chunk
        searchResults = rest as SearchResults
      }
    }
    return (
      searchResults ?? { results: [], images: [], query, number_of_results: 0 }
    )
  }

  return result as SearchResults
}
