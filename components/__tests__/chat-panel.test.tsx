import React from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('../voice/voice-mode', () => ({
  VoiceMode: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="voice-mode-stub">
      <button type="button" data-testid="voice-stub-close" onClick={onClose}>
        close
      </button>
    </div>
  )
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

  test('no separate mobile slot: single anchored card for all viewports', async () => {
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

    // The mobile-only duplicate is gone: one card, anchored to the chips
    // row inside ActionButtons (asserted in action-buttons.test.tsx),
    // so mobile gets the same chips-to-card distance as desktop.
    expect(
      container.querySelector('[data-testid="connector-slot-mobile"]')
    ).toBeNull()
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

  function renderPanel(input: string) {
    return render(
      <ChatPanel
        chatId="chat-1"
        input={input}
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
  }

  test('empty input swaps the send button for the voice button', () => {
    renderPanel('')
    // Default locale is English.
    expect(screen.getByLabelText('Voice input')).toBeInTheDocument()
    expect(screen.queryByLabelText('Send')).not.toBeInTheDocument()
  })

  test('text input restores the send button', () => {
    renderPanel('hello')
    expect(screen.getByLabelText('Send')).toBeInTheDocument()
    expect(screen.queryByLabelText('Voice input')).not.toBeInTheDocument()
  })

  test('voice button opens voice mode, stub close exits it', () => {
    renderPanel('')
    fireEvent.click(screen.getByLabelText('Voice input'))
    expect(screen.getByTestId('voice-mode-stub')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('voice-stub-close'))
    expect(screen.queryByTestId('voice-mode-stub')).not.toBeInTheDocument()
  })
})
