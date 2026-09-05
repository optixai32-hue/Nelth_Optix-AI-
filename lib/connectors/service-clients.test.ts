import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/connectors/vault', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
  hasConnection: vi.fn(async () => true)
}))

import {
  driveRecent,
  githubRecentRepos,
  gmailSearch,
  notionSearch
} from './service-clients'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('recent fallbacks', () => {
  it('gmailSearch with empty query lists latest messages', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        if (url.includes('/messages?q=')) return jsonResponse({ messages: [] })
        return jsonResponse({ messages: [] })
      })
    )
    const res = await gmailSearch('user-1', '', 3)
    expect(res.items).toEqual([])
    expect(seen.some(u => u.includes('/messages?'))).toBe(true)
  })

  it('driveRecent lists latest files without a name query', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return jsonResponse({
          files: [{ id: 'f1', name: 'Budget', mimeType: 'text/plain' }]
        })
      })
    )
    const res = await driveRecent('user-1', 5)
    expect(res.items).toHaveLength(1)
    expect(res.items[0].name).toBe('Budget')
    expect(seen[0]).toContain('orderBy=modifiedTime')
    expect(seen[0]).not.toContain('name%20contains')
  })

  it('githubRecentRepos hits /user/repos', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return jsonResponse([
          { full_name: 'me/app', html_url: 'https://github.com/me/app' }
        ])
      })
    )
    const res = await githubRecentRepos('user-1')
    expect(res.items[0]).toMatchObject({ repo: 'me/app' })
    expect(seen[0]).toContain('/user/repos')
  })

  it('notionSearch with empty query omits query and sorts by edit time', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init?.body as string))
        return jsonResponse({ results: [] })
      })
    )
    await notionSearch('user-1', '')
    expect(bodies[0]).toMatchObject({
      sort: { direction: 'descending', timestamp: 'last_edited_time' }
    })
    expect(bodies[0]).not.toHaveProperty('query')
  })
})
