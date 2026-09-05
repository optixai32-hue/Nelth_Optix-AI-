import React from 'react'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { VoiceMode } from '../voice-mode'

vi.mock('orb-ui', () => ({
  Orb: (props: any) => <div data-testid="voice-orb" data-state={props.state} />
}))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceMode', () => {
  test('renders takeover with orb and close button', () => {
    render(
      <VoiceMode
        onClose={vi.fn()}
        onSubmitText={vi.fn()}
        messages={[]}
        status="ready"
        locale="fr"
      />
    )
    expect(screen.getByTestId('voice-mode')).toBeInTheDocument()
    expect(screen.getByTestId('voice-orb')).toBeInTheDocument()
    expect(screen.getByTestId('voice-close')).toBeInTheDocument()
  })

  test('shows unsupported message where Web Speech is missing', () => {
    render(
      <VoiceMode
        onClose={vi.fn()}
        onSubmitText={vi.fn()}
        messages={[]}
        status="ready"
        locale="fr"
      />
    )
    // jsdom has no SpeechRecognition → unsupported error text
    // (default English locale).
    expect(
      screen.getByText(/not supported in this browser/)
    ).toBeInTheDocument()
    expect(screen.getByTestId('voice-orb')).toHaveAttribute(
      'data-state',
      'error'
    )
  })

  test('X plays the leave animation then closes', async () => {
    const onClose = vi.fn()
    render(
      <VoiceMode
        onClose={onClose}
        onSubmitText={vi.fn()}
        messages={[]}
        status="ready"
        locale="fr"
      />
    )
    fireEvent.click(screen.getByTestId('voice-close'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('voice-mode')).toHaveClass('nelth-voice-leave')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
