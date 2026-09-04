import { describe, expect, it } from 'vitest'

import { buildPreloadedSearchLayer } from '@/lib/agents/researcher'

describe('buildPreloadedSearchLayer', () => {
  const context = '[1] Paris: https://example.com/paris\n  Capital of France.'

  it('labels the injected results with the executed search query', () => {
    const layer = buildPreloadedSearchLayer(
      context,
      'the capital of France And Germany?'
    )
    expect(layer).toContain(
      'Search query used: "the capital of France And Germany?"'
    )
    expect(layer).toContain(context)
    // Existing contract preserved.
    expect(layer).toContain('SERVER-PROVIDED WEB RESULTS')
    expect(layer).toContain('CITATIONS (MANDATORY)')
  })

  it('omits the label when no query is given (backward compatible)', () => {
    const layer = buildPreloadedSearchLayer(context)
    expect(layer).not.toContain('Search query used')
    expect(layer).toContain(context)
  })

  it('returns empty string without context', () => {
    expect(buildPreloadedSearchLayer(undefined)).toBe('')
    expect(buildPreloadedSearchLayer(undefined, 'q')).toBe('')
  })
})
