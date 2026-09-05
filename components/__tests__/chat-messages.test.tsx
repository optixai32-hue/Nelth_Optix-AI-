import React from 'react'

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ChatMessages } from '../chat-messages'

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const scrollContainerRef = { current: null } as any

function userSection(text: string): any[] {
  return [
    {
      id: 's1',
      userMessage: {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text }]
      },
      assistantMessages: []
    }
  ]
}

function labelWrapper(labelText: string): HTMLElement | null {
  // The NelthLoadingLabel span carries aria-live="polite"; inline tool
  // sections (TextShimmer) may show the same text without it.
  const all = screen.getAllByText(labelText)
  const inner = all.find(el => el.closest('span[aria-live="polite"]'))
  return inner?.closest('span[aria-hidden]') ?? null
}

describe('ChatMessages loading shimmer', () => {
  test('weak-model wait (no tool parts): shimmer appears after 500ms', async () => {
    render(
      <ChatMessages
        sections={userSection('résume mes mails')}
        status="submitted"
        scrollContainerRef={scrollContainerRef}
      />
    )
    // Hidden immediately (500ms delay gate).
    expect(labelWrapper('Analyzing…')).toHaveAttribute('aria-hidden', 'true')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(labelWrapper('Analyzing…')).toHaveAttribute('aria-hidden', 'false')
  })

  test('connector activity overrides generic phases', async () => {
    render(
      <ChatMessages
        sections={[
          {
            id: 's1',
            userMessage: {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: 'résume mes mails' }]
            },
            assistantMessages: [
              {
                id: 'a1',
                role: 'assistant',
                parts: [
                  {
                    type: 'tool-gmail',
                    toolCallId: 'c1',
                    state: 'input-available',
                    input: { action: 'search', query: '' }
                  }
                ]
              }
            ]
          }
        ]}
        status="streaming"
        scrollContainerRef={scrollContainerRef}
      />
    )
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(labelWrapper('Connecting to Gmail…')).toHaveAttribute(
      'aria-hidden',
      'false'
    )
  })

  test('no shimmer for trivial greetings', async () => {
    render(
      <ChatMessages
        sections={userSection('bonjour')}
        status="submitted"
        scrollContainerRef={scrollContainerRef}
      />
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(labelWrapper('Analyzing…')).toHaveAttribute('aria-hidden', 'true')
  })
})
