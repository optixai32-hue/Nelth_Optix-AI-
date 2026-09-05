import React from 'react'

import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ConnectorPanel } from '../connector/connector-panel'
import {
  CONNECTOR_SERVICES,
  providerForService
} from '../connector/use-connectors'

const baseProps = {
  open: true,
  onClose: vi.fn(),
  services: CONNECTOR_SERVICES,
  statuses: {
    drive: 'connected',
    gmail: 'connected',
    calendar: 'connected',
    github: 'idle',
    notion: 'idle'
  } as any,
  connectedIds: ['drive', 'gmail', 'calendar'] as any,
  configured: { google: true, github: true, notion: true },
  providerForService,
  onConnect: vi.fn(async () => true),
  onDisconnect: vi.fn(async () => {}),
  onConnected: vi.fn(),
  onError: vi.fn()
}

describe('ConnectorPanel reconnect state', () => {
  test('expired Google grant shows Reconnect instead of green Connected', () => {
    render(
      <ConnectorPanel
        {...baseProps}
        needsReconnect={{ google: true, github: false, notion: false }}
      />
    )
    expect(screen.getByTestId('connector-reconnect-gmail')).toBeInTheDocument()
    expect(
      screen.queryByTestId('connector-status-gmail')
    ).not.toBeInTheDocument()
  })

  test('healthy grant keeps the green Connected pill', () => {
    render(
      <ConnectorPanel
        {...baseProps}
        needsReconnect={{ google: false, github: false, notion: false }}
      />
    )
    expect(screen.getByTestId('connector-status-gmail')).toBeInTheDocument()
    expect(
      screen.queryByTestId('connector-reconnect-gmail')
    ).not.toBeInTheDocument()
  })
})
