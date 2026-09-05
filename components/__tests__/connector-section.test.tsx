import React from 'react'

import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ConnectorSection } from '../connector-section'

const baseProps = {
  isOpen: true,
  onOpenChange: vi.fn(),
  status: 'streaming' as const
}

describe('ConnectorSection', () => {
  test('shows shimmer activity while connecting to Gmail', () => {
    render(
      <ConnectorSection
        {...baseProps}
        tool={
          {
            type: 'tool-gmail',
            toolCallId: 'c1',
            state: 'input-available',
            input: { action: 'search', query: 'facture' }
          } as any
        }
      />
    )
    expect(screen.getByText('Connexion à Gmail…')).toBeInTheDocument()
    expect(screen.getByText('Gmail : facture')).toBeInTheDocument()
  })

  test('summarizes complete results', () => {
    render(
      <ConnectorSection
        {...baseProps}
        tool={
          {
            type: 'tool-gmail',
            toolCallId: 'c2',
            state: 'output-available',
            input: { action: 'search', query: 'facture' },
            output: {
              state: 'complete',
              items: [{ subject: 'Facture' }, { subject: 'Devis' }]
            }
          } as any
        }
      />
    )
    expect(screen.getByText('2 résultats')).toBeInTheDocument()
    expect(screen.getByText('Facture')).toBeInTheDocument()
  })

  test('asks to reconnect on auth-required', () => {
    render(
      <ConnectorSection
        {...baseProps}
        tool={
          {
            type: 'tool-drive',
            toolCallId: 'c3',
            state: 'output-available',
            input: { action: 'search', query: 'budget' },
            output: { state: 'auth-required', provider: 'Google' }
          } as any
        }
      />
    )
    expect(screen.getByText('Reconnexion requise')).toBeInTheDocument()
    expect(
      screen.getByText(/Reconnecte Drive depuis la carte/)
    ).toBeInTheDocument()
  })

  test('shows read character count for single-item reads', () => {
    render(
      <ConnectorSection
        {...baseProps}
        tool={
          {
            type: 'tool-notion',
            toolCallId: 'c4',
            state: 'output-available',
            input: { action: 'read', pageId: 'p1' },
            output: { state: 'complete', title: 'Notes', content: 'abc' }
          } as any
        }
      />
    )
    expect(screen.getByText('3 caractères lus')).toBeInTheDocument()
  })
})
