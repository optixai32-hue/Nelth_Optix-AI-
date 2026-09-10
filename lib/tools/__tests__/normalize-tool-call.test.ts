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

describe('normalizeToolCall — connectors', () => {
  it('unwraps nested parameters and normalizes gmail call', () => {
    const result = normalizeToolCall('id2', 'gmail', {
      parameters: {
        operation: 'list',
        q: 'facture',
        max_results: 3
      }
    })
    expect(result?.name).toBe('gmail')
    expect(result?.arguments).toEqual({
      action: 'search',
      query: 'facture',
      maxResults: 3
    })
  })

  it('normalizes drive tool call with fileName and action get', () => {
    const result = normalizeToolCall('id3', 'drive', {
      operation: 'get',
      file_id: 'doc123'
    })
    expect(result?.name).toBe('drive')
    expect(result?.arguments).toEqual({
      action: 'read',
      query: '',
      maxResults: 10,
      fileId: 'doc123'
    })
  })

  it('normalizes calendar tool call with start and end', () => {
    const result = normalizeToolCall('id4', 'calendar', {
      start: '2026-09-10T00:00:00Z',
      end: '2026-09-17T00:00:00Z',
      q: 'dentiste'
    })
    expect(result?.name).toBe('calendar')
    expect(result?.arguments).toMatchObject({
      timeMin: '2026-09-10T00:00:00Z',
      timeMax: '2026-09-17T00:00:00Z',
      query: 'dentiste',
      maxResults: 10
    })
  })
})
