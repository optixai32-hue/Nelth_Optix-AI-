import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/connectors/vault', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
  hasConnection: vi.fn(async () => false)
}))

import { createConnectorTools } from './connectors'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function collect(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url)
      // Authorization header must always carry the vault token.
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-token')
      return impl(url)
    })
  )
  return calls
}

const tools = createConnectorTools('user-1')

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('gmail tool', () => {
  it('searches then maps metadata', async () => {
    stubFetch(url => {
      if (url.includes('/messages?q=')) {
        return jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }] })
      }
      if (url.includes('/messages/m1?')) {
        return jsonResponse({
          snippet: 'snip-1',
          payload: {
            headers: [
              { name: 'Subject', value: 'Facture' },
              { name: 'From', value: 'a@x.com' },
              { name: 'Date', value: 'Mon' }
            ]
          }
        })
      }
      return jsonResponse({
        snippet: 'snip-2',
        payload: {
          headers: [
            { name: 'Subject', value: 'Bonjour' },
            { name: 'From', value: 'b@x.com' },
            { name: 'Date', value: 'Tue' }
          ]
        }
      })
    })
    const chunks = await collect(
      (tools.gmail.execute as any)({ action: 'search', query: 'facture' }, {})
    )
    expect(chunks[0]).toMatchObject({ state: 'connecting', service: 'gmail' })
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.items).toHaveLength(2)
    expect(final.items[0]).toMatchObject({ id: 'm1', subject: 'Facture' })
  })

  it('reads a full message body', async () => {
    const body = Buffer.from('Hello world', 'utf-8').toString('base64url')
    stubFetch(() =>
      jsonResponse({
        snippet: 'Hello',
        payload: {
          headers: [{ name: 'Subject', value: 'Hi' }],
          parts: [{ mimeType: 'text/plain', body: { data: body } }]
        }
      })
    )
    const chunks = await collect(
      (tools.gmail.execute as any)({ action: 'read', messageId: 'm9' }, {})
    )
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.body).toContain('Hello world')
  })

  it('surfaces auth-required on 401', async () => {
    stubFetch(() => new Response('unauthorized', { status: 401 }))
    const chunks = await collect(
      (tools.gmail.execute as any)({ action: 'search', query: 'x' }, {})
    )
    expect(chunks[chunks.length - 1]).toMatchObject({
      state: 'auth-required',
      provider: 'Google'
    })
  })

  it('requires messageId for read', async () => {
    stubFetch(() => jsonResponse({}))
    const chunks = await collect(
      (tools.gmail.execute as any)({ action: 'read' }, {})
    )
    expect(chunks[chunks.length - 1]).toMatchObject({ state: 'error' })
  })
})

describe('drive tool', () => {
  it('reads a Google Doc via export', async () => {
    const calls = stubFetch(url => {
      if (url.includes('/files/doc1?fields=')) {
        return jsonResponse({
          id: 'doc1',
          name: 'Notes',
          mimeType: 'application/vnd.google-apps.document'
        })
      }
      return new Response('exported text', { status: 200 })
    })
    const chunks = await collect(
      (tools.drive.execute as any)({ action: 'read', fileId: 'doc1' }, {})
    )
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.content).toContain('exported text')
    expect(calls.some(c => c.includes('/export?'))).toBe(true)
  })

  it('marks binary files as unreadable', async () => {
    stubFetch(() =>
      jsonResponse({
        id: 'bin',
        name: 'a.png',
        mimeType: 'image/png',
        size: '42'
      })
    )
    const chunks = await collect(
      (tools.drive.execute as any)({ action: 'read', fileId: 'bin' }, {})
    )
    const final = chunks[chunks.length - 1] as any
    expect(final).toMatchObject({ state: 'complete', readable: false })
  })
})

describe('calendar tool', () => {
  it('lists upcoming events', async () => {
    stubFetch(() =>
      jsonResponse({
        items: [
          {
            id: 'e1',
            summary: 'Dentiste',
            start: { dateTime: '2026-09-06T10:00:00Z' },
            end: { dateTime: '2026-09-06T11:00:00Z' }
          }
        ]
      })
    )
    const chunks = await collect((tools.calendar.execute as any)({}, {}))
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.items[0]).toMatchObject({ summary: 'Dentiste' })
  })
})

describe('github tool', () => {
  it('reads a file and decodes base64', async () => {
    const content = Buffer.from('const a = 1', 'utf-8').toString('base64')
    stubFetch(() => jsonResponse({ encoding: 'base64', content, size: 11 }))
    const chunks = await collect(
      (tools.github.execute as any)(
        { action: 'read', owner: 'o', repo: 'r', path: 'a.ts' },
        {}
      )
    )
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.content).toContain('const a = 1')
  })

  it('maps network failures to error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      })
    )
    const chunks = await collect(
      (tools.github.execute as any)({ action: 'search', query: 'x' }, {})
    )
    expect(chunks[chunks.length - 1]).toMatchObject({ state: 'error' })
  })
})

describe('notion tool', () => {
  it('searches pages and extracts titles', async () => {
    stubFetch(() =>
      jsonResponse({
        results: [
          {
            id: 'p1',
            url: 'https://notion.so/p1',
            properties: {
              title: {
                type: 'title',
                title: [{ plain_text: 'Mes notes' }]
              }
            }
          }
        ]
      })
    )
    const chunks = await collect(
      (tools.notion.execute as any)({ action: 'search', query: 'notes' }, {})
    )
    const final = chunks[chunks.length - 1] as any
    expect(final.state).toBe('complete')
    expect(final.items[0]).toMatchObject({ id: 'p1', title: 'Mes notes' })
  })
})
