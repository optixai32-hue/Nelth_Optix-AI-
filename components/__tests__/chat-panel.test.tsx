import React from 'react'

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { deleteCookie, getCookie, setCookie } from '@/lib/utils/cookies'

import { ChatPanel } from '../chat-panel'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('../artifact/artifact-context', () => ({
  useArtifact: () => ({ close: vi.fn() })
}))

vi.mock('../action-buttons', () => ({
  ActionButtons: () => null
}))

vi.mock('../library/library-context', () => ({
  useLibrary: () => ({
    upsertCachedFile: vi.fn()
  })
}))

vi.mock('../library/library-picker-dialog', () => ({
  LibraryPickerDialog: () => null
}))

vi.mock('../message-navigation-dots', () => ({
  MessageNavigationDots: () => null
}))

vi.mock('../uploaded-file-list', () => ({
  UploadedFileList: () => null
}))

vi.mock('../ui/icons', () => ({
  IconBlinkingLogo: () => <div data-testid="logo" />,
  IconLogoOutline: ({ className }: { className?: string }) => (
    <span className={className} data-testid="adaptive-icon" />
  )
}))

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteCookie('searchMode')
  })

  test('preserves and submits the initial query after resetting a stale adaptive cookie', async () => {
    const append = vi.fn()
    const onAdaptiveModeAuthRequired = vi.fn()
    setCookie('searchMode', 'adaptive')

    render(
      <ChatPanel
        chatId="chat-1"
        input=""
        handleInputChange={vi.fn()}
        handleSubmit={vi.fn()}
        status="ready"
        messages={[]}
        setMessages={vi.fn()}
        query="latest news"
        stop={vi.fn()}
        append={append}
        showScrollToBottomButton={false}
        scrollContainerRef={React.createRef<HTMLDivElement>()}
        uploadedFiles={[]}
        setUploadedFiles={vi.fn()}
        quotedContexts={[]}
        setQuotedContexts={vi.fn()}
        noteContexts={[]}
        setNoteContexts={vi.fn()}
        isGuest
        isCloudDeployment
        onAdaptiveModeAuthRequired={onAdaptiveModeAuthRequired}
      />
    )

    await waitFor(() => {
      expect(getCookie('searchMode')).toBe('quick')
    })
    await waitFor(() => {
      expect(append).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ type: 'text', text: 'latest news' }]
      })
    })
    expect(onAdaptiveModeAuthRequired).not.toHaveBeenCalled()
  })

  test('reserves a stable slot for the connector card below quick actions', async () => {
    const { container } = render(
      <ChatPanel
        chatId="chat-1"
        input=""
        handleInputChange={vi.fn()}
        handleSubmit={vi.fn()}
        status="ready"
        messages={[]}
        setMessages={vi.fn()}
        query=""
        stop={vi.fn()}
        append={vi.fn()}
        showScrollToBottomButton={false}
        scrollContainerRef={React.createRef<HTMLDivElement>()}
        uploadedFiles={[]}
        setUploadedFiles={vi.fn()}
        quotedContexts={[]}
        setQuotedContexts={vi.fn()}
        noteContexts={[]}
        setNoteContexts={vi.fn()}
        isGuest
        isCloudDeployment
        onAdaptiveModeAuthRequired={vi.fn()}
      />
    )

    const slot = container.querySelector('[data-testid="connector-slot"]')
    expect(slot).not.toBeNull()
    // Overlay anchoring: the slot is zero-height (relative wrapper) and the
    // card is absolutely positioned below the chips, so the logo, composer
    // and chips keep their exact original positions — no reserved space
    // pushes them up, and mount/dismiss never shifts them.
    expect(slot?.className).toContain('relative')
    expect(slot?.className).not.toContain('min-h-')
    const anchored = slot?.querySelector('.absolute')
    expect(anchored).not.toBeNull()
    // Tight gap: the card sits just under the quick actions.
    expect(anchored?.className).toContain('mt-1')
  })

  test('short viewports compact the empty state so the card stays visible', () => {
    const { container } = render(
      <ChatPanel
        chatId="chat-1"
        input=""
        handleInputChange={vi.fn()}
        handleSubmit={vi.fn()}
        status="ready"
        messages={[]}
        setMessages={vi.fn()}
        query=""
        stop={vi.fn()}
        append={vi.fn()}
        showScrollToBottomButton={false}
        scrollContainerRef={React.createRef<HTMLDivElement>()}
        uploadedFiles={[]}
        setUploadedFiles={vi.fn()}
        quotedContexts={[]}
        setQuotedContexts={vi.fn()}
        noteContexts={[]}
        setNoteContexts={vi.fn()}
        isGuest
        isCloudDeployment
        onAdaptiveModeAuthRequired={vi.fn()}
      />
    )

    // Height-scoped compaction only (tall screens pixel-identical).
    const hero = container.querySelector('[data-testid="empty-hero"]')
    expect(hero?.className).toContain('max-height')
  })
})
