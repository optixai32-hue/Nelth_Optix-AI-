import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isVoiceRecognitionSupported,
  useVoiceRecognition,
  type VoiceRecognitionCallbacks
} from '../use-voice-recognition'

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: any) => void) | null = null
  onstop: (() => void) | null = null
  constructor(
    public stream: any,
    public opts?: any
  ) {
    MockMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob(['x'.repeat(5000)], { type: 'audio/webm' })
    })
    this.onstop?.()
  }
}

// Microphone level seen by the analyser (drives energy VAD).
let fakeLevel = 0

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
  function MockAudioContext(this: any) {
    return {
      state: 'running',
      resume: async () => {},
      createMediaStreamSource: () => ({ connect: () => {} }),
      createAnalyser: () => ({
        fftSize: 0,
        smoothingTimeConstant: 0,
        frequencyBinCount: 8,
        getByteFrequencyData: (a: Uint8Array) => a.fill(fakeLevel)
      }),
      close: async () => {}
    }
  }
  ;(window as any).AudioContext = MockAudioContext
  ;(window as any).MediaRecorder = MockMediaRecorder
}

function stubTranscribe(text: string | null) {
  const calls: Array<{ url: string; hasAudio: boolean }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body as FormData | undefined
      calls.push({
        url,
        hasAudio:
          !!body &&
          typeof (body as any).get === 'function' &&
          (body as any).get('audio') instanceof Blob
      })
      if (text === null) {
        return new Response('boom', { status: 500 })
      }
      return Response.json({
        success: true,
        transcription: { text },
        processingMs: 120
      })
    })
  )
  return calls
}

function makeCallbacks() {
  return {
    onInterimText: vi.fn(),
    onFinalText: vi.fn(),
    onStateChange: vi.fn(),
    onAudioLevel: vi.fn(),
    onError: vi.fn()
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

beforeEach(() => {
  MockMediaRecorder.instances = []
  fakeLevel = 0
  delete (window as any).MediaRecorder
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useVoiceRecognition (Space-Z STT)', () => {
  it('reports unsupported without MediaRecorder', async () => {
    expect(isVoiceRecognitionSupported()).toBe(false)
    const ref = { current: makeCallbacks() }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))
    let ok = true
    await act(async () => {
      ok = await result.current.start()
    })
    expect(ok).toBe(false)
    expect(result.current.state).toBe('unsupported')
  })

  it('records speech, posts it, and submits the transcription', async () => {
    mockAudio()
    expect(isVoiceRecognitionSupported()).toBe(true)
    const fetchCalls = stubTranscribe('bonjour tout le monde')
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.state).toBe('listening')
    expect(MockMediaRecorder.instances).toHaveLength(1)

    // Speak, then go quiet: VAD closes the cycle and transcribes.
    fakeLevel = 200
    await act(async () => {
      await wait(400)
    })
    fakeLevel = 0
    await act(async () => {
      await wait(2500)
    })

    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].url).toBe(
      'https://nelth-stt.space-z.ai/api/transcribe'
    )
    expect(fetchCalls[0].hasAudio).toBe(true)
    expect(cbs.onFinalText).toHaveBeenCalledWith('bonjour tout le monde')
    // A fresh cycle is already listening again.
    expect(result.current.state).toBe('listening')
  })

  it('mutes by discarding without any network call', async () => {
    mockAudio()
    const fetchCalls = stubTranscribe('hello')
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    fakeLevel = 200
    await act(async () => {
      await wait(300)
    })
    act(() => {
      result.current.setMuted(true)
    })
    fakeLevel = 0
    await act(async () => {
      await wait(1500)
    })
    expect(fetchCalls.length).toBe(0)
    expect(cbs.onFinalText).not.toHaveBeenCalled()
  })

  it('stays silent on empty transcription and keeps listening', async () => {
    mockAudio()
    stubTranscribe('   ')
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    fakeLevel = 200
    await act(async () => {
      await wait(400)
    })
    fakeLevel = 0
    await act(async () => {
      await wait(2500)
    })
    expect(cbs.onFinalText).not.toHaveBeenCalled()
    expect(result.current.state).toBe('listening')
  })

  it('survives endpoint errors without breaking the session', async () => {
    mockAudio()
    stubTranscribe(null)
    const cbs = makeCallbacks()
    const ref = { current: cbs }
    const { result } = renderHook(() => useVoiceRecognition(ref, 'fr'))

    await act(async () => {
      await result.current.start()
    })
    fakeLevel = 200
    await act(async () => {
      await wait(400)
    })
    fakeLevel = 0
    await act(async () => {
      await wait(2500)
    })
    expect(cbs.onFinalText).not.toHaveBeenCalled()
    expect(result.current.state).toBe('listening')
  })
})
