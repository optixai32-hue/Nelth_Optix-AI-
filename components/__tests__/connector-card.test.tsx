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

  test('connecting a service shows success and persists it', async () => {
    render(<ConnectorCard />)
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
    expect(JSON.parse(window.localStorage.getItem(CONNECTED_KEY) ?? '[]')).toContain(
      'drive'
    )
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
})
