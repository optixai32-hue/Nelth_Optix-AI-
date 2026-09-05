import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/connectors/vault', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
  hasConnection: vi.fn(async () => true)
}))

import {
  calendarList,
  driveRecent,
  driveSearch,
  githubRecentRepos,
  gmailRead,
  gmailSearch,
  notionRead,
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

  it('driveSearch includes shared drives', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return jsonResponse({ files: [] })
      })
    )
    await driveSearch('user-1', 'budget', 5)
    expect(seen[0]).toContain('supportsAllDrives=true')
    expect(seen[0]).toContain('includeItemsFromAllDrives=true')
  })

  it('gmailRead falls back to stripped HTML when no plain part', async () => {
    const html = Buffer.from(
      '<html><body><p>Hello <b>Marie</b></p><script>evil()</script></body></html>',
      'utf-8'
    ).toString('base64url')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          snippet: 'Hello',
          payload: {
            headers: [{ name: 'Subject', value: 'Hi' }],
            parts: [{ mimeType: 'text/html', body: { data: html } }]
          }
        })
      )
    )
    const msg = await gmailRead('user-1', 'm1')
    expect(msg.body).toContain('Hello Marie')
    expect(msg.body).not.toContain('evil()')
    expect(msg.body).not.toContain('<p>')
  })

  it('notionRead follows pagination cursors', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        if (url.includes('/v1/pages/')) {
          return jsonResponse({
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Doc' }] }
            }
          })
        }
        if (url.includes('start_cursor')) {
          return jsonResponse({
            results: [
              {
                id: 'b2',
                type: 'paragraph',
                paragraph: { rich_text: [{ plain_text: 'page two' }] }
              }
            ],
            has_more: false
          })
        }
        return jsonResponse({
          results: [
            {
              id: 'b1',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'page one' }] }
            }
          ],
          has_more: true,
          next_cursor: 'cur-1'
        })
      })
    )
    const page = await notionRead('user-1', 'p1')
    expect(page.content).toContain('page one')
    expect(page.content).toContain('page two')
    expect(seen.some(u => u.includes('start_cursor'))).toBe(true)
  })

  it('calendarList flags all-day events and forwards timeZone', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return jsonResponse({
          items: [
            {
              id: 'e1',
              summary: 'Fête',
              start: { date: '2026-09-06' },
              end: { date: '2026-09-07' }
            }
          ]
        })
      })
    )
    const res = await calendarList(
      'user-1',
      undefined,
      undefined,
      5,
      undefined,
      'Indian/Antananarivo'
    )
    expect(res.items[0]).toMatchObject({ summary: 'Fête', allDay: true })
    expect(seen[0]).toContain('timeZone=Indian%2FAntananarivo')
  })
})
