import { describe, expect, it } from 'vitest'

import { wrapSearchToolForQuickMode } from '@/lib/agents/researcher'

// Minimal fake of the search tool shape: streaming execute yielding a
// searching state then a complete payload with results.
function makeFakeSearchTool() {
  return {
    description: 'fake search',
    inputSchema: {} as never,
    toModelOutput: undefined as never,
    async *execute(params: { query: string }) {
      yield { state: 'searching' as const, query: params.query }
      yield {
        state: 'complete' as const,
        results: [
          {
            title: 'Elon Musk',
            url: 'https://example.com/elon',
            content: 'CEO of Tesla'
          }
        ],
        images: [],
        query: params.query,
        number_of_results: 1
      }
    }
  }
}

async function collect(gen: AsyncIterable<unknown>) {
  const out: unknown[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('wrapSearchToolForQuickMode single-search cap', () => {
  it('passes the first search through untouched', async () => {
    const wrapped = wrapSearchToolForQuickMode(makeFakeSearchTool())
    const chunks = await collect(
      (wrapped.execute as Function)({ query: 'elon musk' }, {})
    )
    const complete = chunks.find(
      (c: any) => c?.state === 'complete'
    ) as any
    expect(complete.number_of_results).toBe(1)
    expect(complete.results).toHaveLength(1)
    expect(complete.note).toBeUndefined()
  })

  it('replays cached results with a stop-note instead of empty payloads', async () => {
    const wrapped = wrapSearchToolForQuickMode(makeFakeSearchTool())
    const exec = wrapped.execute as Function
    await collect(exec({ query: 'elon musk' }, {}))
    const chunks = await collect(exec({ query: 'elon musk age' }, {}))
    const complete = chunks.find(
      (c: any) => c?.state === 'complete'
    ) as any
    // Same results as the first search — never empty (empty caused retry loops).
    expect(complete.number_of_results).toBe(1)
    expect(complete.results).toHaveLength(1)
    expect(complete.results[0].url).toBe('https://example.com/elon')
    expect(typeof complete.note).toBe('string')
    expect(complete.note).toMatch(/do NOT search again/i)
  })
})
