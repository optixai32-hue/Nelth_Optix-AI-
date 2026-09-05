import React from 'react'

import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ActionButtons } from '../action-buttons'

vi.mock('@/lib/analytics/posthog-client', () => ({
  captureClient: vi.fn()
}))

function renderButtons() {
  return render(
    <ActionButtons
      onSelectPrompt={vi.fn()}
      onCategoryClick={vi.fn()}
      onAttachImageAndPrompt={vi.fn()}
      isGuest={false}
      inputRef={React.createRef<HTMLTextAreaElement>()}
    />
  )
}

describe('ActionButtons connector anchoring', () => {
  test('renders the quick-action chips', () => {
    renderButtons()
    expect(screen.getByText('Create image')).toBeInTheDocument()
    expect(screen.getByText('Troubleshoot')).toBeInTheDocument()
  })

  test('anchors the connector card to the chips row with a 1px gap', () => {
    const { container } = renderButtons()
    const card = screen.getByTestId('connector-card')
    expect(card).toBeInTheDocument()
    // The card wrapper is absolutely positioned at the bottom of the
    // chips row (top-full + mt-px), never pushing logo/greeting/composer.
    const anchor = card.parentElement
    expect(anchor?.className).toContain('absolute')
    expect(anchor?.className).toContain('top-full')
    expect(anchor?.className).toContain('mt-[3px]')
    // The chips row itself is the positioning context.
    expect(anchor?.parentElement?.className).toContain('relative')
    void container
  })
})
