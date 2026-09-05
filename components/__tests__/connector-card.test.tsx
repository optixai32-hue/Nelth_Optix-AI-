import React from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ConnectorCard } from '../connector/connector-card'

vi.mock('@/lib/analytics/posthog-client', () => ({
  captureClient: vi.fn()
}))

const CONNECTED_KEY = 'nelth.connectors.connected'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem(CONNECTED_KEY)
})

describe('ConnectorCard', () => {
  test('renders title, description and connect button', () => {
    render(<ConnectorCard />)
    expect(screen.getByTestId('connector-card')).toBeInTheDocument()
    expect(screen.getByTestId('connector-connect')).toBeInTheDocument()
    expect(screen.getByTestId('connector-dismiss')).toBeInTheDocument()
  })

  test('dismiss animates out and unmounts for this view only', async () => {
    render(<ConnectorCard />)
    fireEvent.click(screen.getByTestId('connector-dismiss'))
    // Exit animation state first.
    expect(screen.getByTestId('connector-card')).toHaveAttribute(
      'data-phase',
      'leaving'
    )
    await waitFor(() => {
      expect(screen.queryByTestId('connector-card')).not.toBeInTheDocument()
    })
    // Dismissal is NOT persisted: nothing stored, card returns on remount.
    expect(window.localStorage.getItem('nelth.connector-card.dismissed')).toBeNull()
  })

  test('shows again on remount after dismiss (e.g. page refresh)', async () => {
    const { unmount } = render(<ConnectorCard />)
    fireEvent.click(screen.getByTestId('connector-dismiss'))
    await waitFor(() => {
      expect(screen.queryByTestId('connector-card')).not.toBeInTheDocument()
    })
    unmount()
    render(<ConnectorCard />)
    expect(screen.getByTestId('connector-card')).toBeInTheDocument()
  })

  test('connect shows loading then opens the OAuth panel', async () => {
    render(<ConnectorCard />)
    fireEvent.click(screen.getByTestId('connector-connect'))
    await waitFor(() => {
      expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
    })
    // Panel lists the five services.
    expect(screen.getByTestId('connector-service-drive')).toBeInTheDocument()
    expect(screen.getByTestId('connector-service-github')).toBeInTheDocument()
  })

  test('connecting a service shows success via injected impl', async () => {
    render(
      <ConnectorCard connectImpl={() => Promise.resolve()} />
    )
    fireEvent.click(screen.getByTestId('connector-connect'))
    await waitFor(() => {
      expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('connector-service-drive'))
    await waitFor(() => {
      expect(
        screen.getByTestId('connector-status-drive')
      ).toBeInTheDocument()
    })
  })

  test('a failing connect surfaces retry state', async () => {
    render(
      <ConnectorCard connectImpl={() => Promise.reject(new Error('nope'))} />
    )
    fireEvent.click(screen.getByTestId('connector-connect'))
    await waitFor(() => {
      expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('connector-service-gmail'))
    await waitFor(() => {
      // Default locale in tests is English.
      expect(
        screen.getByTestId('connector-service-gmail')
      ).toHaveTextContent('Retry')
    })
  })

  test('panel closes on backdrop click', async () => {
    render(<ConnectorCard />)
    fireEvent.click(screen.getByTestId('connector-connect'))
    await waitFor(() => {
      expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('connector-panel-backdrop'))
    await waitFor(() => {
      expect(screen.queryByTestId('connector-panel')).not.toBeInTheDocument()
    })
  })

  test('hydrates connected state from the server (vault is source of truth)', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/connectors/status')) {
        return {
          ok: true,
          json: async () => ({
            connected: {
              drive: false,
              gmail: false,
              calendar: false,
              github: true,
              notion: false
            },
            configured: { google: true, github: true, notion: true },
            guest: false
          })
        }
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<ConnectorCard />)
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/connectors/status',
          expect.anything()
        )
      })
      fireEvent.click(screen.getByTestId('connector-connect'))
      await waitFor(() => {
        expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
      })
      // GitHub comes from the server as connected — no localStorage involved.
      await waitFor(() => {
        expect(
          screen.getByTestId('connector-status-github')
        ).toBeInTheDocument()
      })
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('unconfigured providers show a disabled state', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        connected: {
          drive: false,
          gmail: false,
          calendar: false,
          github: false,
          notion: false
        },
        configured: { google: false, github: false, notion: true },
        guest: false
      })
    }))
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<ConnectorCard />)
      fireEvent.click(screen.getByTestId('connector-connect'))
      await waitFor(() => {
        expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(
          screen.getByTestId('connector-unconfigured-drive')
        ).toBeInTheDocument()
      })
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('disconnect calls the API and clears the row', async () => {
    const calls: unknown[] = []
    const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/api/connectors/disconnect')) {
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return {
        ok: true,
        json: async () => ({
          connected: {
            drive: true,
            gmail: true,
            calendar: true,
            github: false,
            notion: false
          },
          configured: { google: true, github: true, notion: true },
          guest: false
        })
      }
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<ConnectorCard />)
      fireEvent.click(screen.getByTestId('connector-connect'))
      await waitFor(() => {
        expect(screen.getByTestId('connector-panel')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(
          screen.getByTestId('connector-status-drive')
        ).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('connector-disconnect-drive'))
      await waitFor(() => {
        expect(
          calls.some(
            c =>
              (c as { url: string }).url.includes(
                '/api/connectors/disconnect'
              )
          )
        ).toBe(true)
      })
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
