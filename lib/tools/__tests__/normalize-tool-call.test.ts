import { describe, expect, it } from 'vitest'

import { normalizeToolCall } from '@/lib/tools/runtime/normalize-tool-call'

describe('normalizeToolCall — search', () => {
  it('preserves a valid image content type instead of forcing web', () => {
    const result = normalizeToolCall('id1', 'search', {
      query: 'cats',
      content_types: ['image']
    })
    expect(result?.name).toBe('search')
    expect(
      (result?.arguments as { content_types: string[] }).content_types
    ).toEqual(['image'])
  })

  it('preserves domain allow/deny lists', () => {
    const result = normalizeToolCall('id1', 'search', {
      query: 'cats',
      include_domains: 'example.com',
      exclude_domains: ['spam.example']
    })
    const args = result?.arguments as {
      include_domains: string[]
      exclude_domains: string[]
    }
    expect(args.include_domains).toEqual(['example.com'])
    expect(args.exclude_domains).toEqual(['spam.example'])
  })

  it('repairs legacy field names and defaults to web', () => {
    const result = normalizeToolCall('id1', 'search', {
      q: 'cats',
      topk: 5
    })
    const args = result?.arguments as {
      query: string
      content_types: string[]
      max_results: number
    }
    expect(args.query).toBe('cats')
    expect(args.content_types).toEqual(['web'])
    expect(args.max_results).toBe(5)
  })

  it('drops invalid content types and falls back to web', () => {
    const result = normalizeToolCall('id1', 'search', {
      query: 'cats',
      content_types: ['teleport']
    })
    expect(
      (result?.arguments as { content_types: string[] }).content_types
    ).toEqual(['web'])
  })
})
