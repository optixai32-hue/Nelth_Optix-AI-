import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isVoiceRecognitionSupported,
  useVoiceRecognition,
  type VoiceRecognitionCallbacks
} from '../use-voice-recognition'

class MockRecognition {
  static instances: MockRecognition[] = []
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = ''
  onresult: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  started = false
  startCalls = 0
  constructor() {
    MockRecognition.instances.push(this)
  }
  start() {
    this.started = true
    this.startCalls++
    this.onstart?.()
  }
  stop() {
    this.started = false
  }
  emitResult(transcript: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript }, isFinal, length: 1 }]
    })
  }
}

function mockAudio() {
  const stop = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        active: true,
        getAudioTracks: () => [{ readyState: 'live', enabled: true }],
        getTracks: () => [{ stop }]
      }))
    }
  })
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 8,
    getByteFrequencyData: (a: Uint8Array) => a.fill(0)
  }
  function MockAudioContext(this: any) {
    return {
      state: 'running',
      resume: async () => {},
      createMediaStreamSource: () => ({ connect: () => {} }),
      createAnalyser: () => analyser,
      close: async () => {}
    }
  }
  ;(window as any).AudioContext = MockAudioContext
}

function makeCallbacks(): VoiceRecognitionCallbacks & {
  [k: string]: any
} {
  return {
    onInterimText: vi.fn(),
    onFinalText: vi.fn(),
    onStateChange: vi.fn(),
    onAudioLevel: vi.fn(),
    onError: vi.fn()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  MockRecognition.instances = []
  delete (window as any).SpeechRecognition
  delete (window as any).webkitSpeechRecognition
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useVoiceRecognition', () => {
  it('reports unsupported when no SpeechRecognition class exists', async () => {
    expect(isVoiceRecognitionSupported()).toBe(false)
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))
    let ok = true
    await act(async () => {
      ok = await result.current.start()
    })
    expect(ok).toBe(false)
    expect(result.current.state).toBe('unsupported')
  })

  it('listens once and submits interim text after silence', async () => {
    ;(window as any).webkitSpeechRecognition = MockRecognition
    expect(isVoiceRecognitionSupported()).toBe(true)
    mockAudio()
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.state).toBe('listening')
    expect(MockRecognition.instances).toHaveLength(1)

    const rec = MockRecognition.instances[0]
    act(() => {
      rec.emitResult('bonjour', false)
    })
    expect(cbs.onInterimText).toHaveBeenCalledWith('bonjour')
    expect(cbs.onFinalText).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    expect(cbs.onFinalText).toHaveBeenCalledWith('bonjour')
  })

  it('ignores results while muted (no session restart)', async () => {
    ;(window as any).webkitSpeechRecognition = MockRecognition
    mockAudio()
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    act(() => {
      result.current.setMuted(true)
    })
    act(() => {
      MockRecognition.instances[0].emitResult('hello', false)
    })
    expect(cbs.onInterimText).not.toHaveBeenCalled()
    // Session still alive: no extra recognition instance was created.
    expect(MockRecognition.instances).toHaveLength(1)
  })

  it('maps mic denial to the denied state', async () => {
    ;(window as any).webkitSpeechRecognition = MockRecognition
    mockAudio()
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    act(() => {
      MockRecognition.instances[0].onerror?.({ error: 'not-allowed' })
    })
    expect(result.current.state).toBe('denied')
    expect(cbs.onError).toHaveBeenCalled()
  })

  it('revives the session when unmuting after it ended muted', async () => {
    ;(window as any).webkitSpeechRecognition = MockRecognition
    mockAudio()
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    const rec = MockRecognition.instances[0]
    const startsBefore = rec.startCalls

    // Mute (AI speaking), then the session ends underneath.
    act(() => {
      result.current.setMuted(true)
    })
    act(() => {
      rec.onend?.()
    })
    // No restart while muted — and no new instance.
    expect(MockRecognition.instances).toHaveLength(1)
    expect(rec.startCalls).toBe(startsBefore)

    // Unmuting revives the dead session on the SAME instance.
    act(() => {
      result.current.setMuted(false)
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(rec.startCalls).toBe(startsBefore + 1)
  })
})
