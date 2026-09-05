'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceRecState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'denied'
  | 'unsupported'
  | 'error'

export interface VoiceRecognitionCallbacks {
  onInterimText: (text: string) => void
  onFinalText: (text: string) => void
  onStateChange: (state: VoiceRecState) => void
  onAudioLevel?: (level: number) => void
  onError?: (message: string) => void
}

/**
 * Space-Z speech-to-text endpoint. Override with
 * NEXT_PUBLIC_VOICE_STT_BASE_URL when self-hosting.
 */
const STT_BASE = (
  process.env.NEXT_PUBLIC_VOICE_STT_BASE_URL ?? 'https://nelth-stt.space-z.ai'
).replace(/\/+$/, '')

const STT_TIMEOUT_MS = 30_000
// Energy voice-activity detection on the mic analyser.
const VAD_SPEECH_THRESHOLD = 0.12
const VAD_SILENCE_END_MS = 900
const MAX_RECORD_MS = 30_000
const MIN_BLOB_BYTES = 1500

function mediaSupport(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return false
  return (
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** True when the browser can record microphone audio at all. */
export function isVoiceRecognitionSupported(): boolean {
  return mediaSupport()
}

function pickMimeType(): string {
  try {
    const MR = MediaRecorder as unknown as {
      isTypeSupported?: (mime: string) => boolean
    }
    if (typeof MR.isTypeSupported !== 'function') return ''
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg'
    ]
    for (const mime of candidates) {
      try {
        if (MR.isTypeSupported(mime)) return mime
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

function extForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * Microphone → Space-Z STT for the voice mode.
 *
 * One recording cycle per spoken turn (MediaRecorder has no system beep on
 * any device, so per-turn record/stop is silent — including Android):
 * mic level drives voice-activity detection, 900 ms of silence (or 30 s
 * max) closes the cycle, the blob is POSTed as FormData to
 * `/api/transcribe`, and `transcription.text` is submitted. While the AI
 * thinks or speaks the recorder stays stopped (no TTS echo); a new cycle
 * starts on unmute.
 */
export function useVoiceRecognition(
  callbacksRef: React.MutableRefObject<VoiceRecognitionCallbacks>,
  locale: string
) {
  const [state, setState] = useState<VoiceRecState>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef('')
  const listeningRef = useRef(false)
  const mutedRef = useRef(false)
  const transcribingRef = useRef(false)
  const discardRef = useRef(false)
  const cycleStartRef = useRef(0)
  const hadSpeechRef = useRef(false)
  const lastSpeechRef = useRef(0)
  const langRef = useRef('fr-FR')
  const stateRef = useRef<VoiceRecState>('idle')

  const setRecState = useCallback(
    (next: VoiceRecState) => {
      stateRef.current = next
      setState(next)
      callbacksRef.current.onStateChange(next)
    },
    [callbacksRef]
  )

  const submitFinal = useCallback(
    (text: string) => {
      const clean = text.trim()
      if (!clean) return
      callbacksRef.current.onFinalText(clean)
    },
    [callbacksRef]
  )

  const stopLevelLoop = useCallback(() => {
    if (levelTimerRef.current !== null) {
      clearInterval(levelTimerRef.current)
      levelTimerRef.current = null
    }
  }, [])

  const teardownAudio = useCallback(() => {
    stopLevelLoop()
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => t.stop())
      } catch {
        /* ignore */
      }
      streamRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    analyserRef.current = null
  }, [stopLevelLoop])

  const transcribeBlob = useCallback(async (blob: Blob): Promise<string> => {
    const fd = new FormData()
    fd.append('audio', blob, `speech.${extForMime(mimeRef.current)}`)
    const res = await fetch(`${STT_BASE}/api/transcribe`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`STT HTTP ${res.status}`)
    const data = (await res.json().catch(() => null)) as {
      success?: unknown
      transcription?: { text?: unknown }
    } | null
    if (!data?.success) return ''
    const text = data.transcription?.text
    return typeof text === 'string' ? text.trim() : ''
  }, [])

  const startCycle = useCallback(() => {
    if (
      !listeningRef.current ||
      mutedRef.current ||
      transcribingRef.current ||
      recorderRef.current
    ) {
      return
    }
    const stream = streamRef.current
    if (!stream) return
    try {
      const mime = pickMimeType()
      mimeRef.current = mime
      chunksRef.current = []
      hadSpeechRef.current = false
      discardRef.current = false
      cycleStartRef.current = Date.now()
      lastSpeechRef.current = 0
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        void finishCycle()
      }
      recorderRef.current = recorder
      recorder.start(250)
    } catch {
      recorderRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishCycle = useCallback(async () => {
    if (!listeningRef.current) return
    const chunks = chunksRef.current
    chunksRef.current = []
    const discard = discardRef.current
    discardRef.current = false
    const hadSpeech = hadSpeechRef.current
    hadSpeechRef.current = false
    if (mutedRef.current || discard || !hadSpeech) {
      // Silence, echo window, or discarded turn — listen again, no network.
      if (listeningRef.current && !mutedRef.current) startCycle()
      return
    }
    const blob = new Blob(chunks, {
      type: mimeRef.current || 'audio/webm'
    })
    if (blob.size < MIN_BLOB_BYTES) {
      if (listeningRef.current && !mutedRef.current) startCycle()
      return
    }
    transcribingRef.current = true
    setRecState('transcribing')
    try {
      const text = await transcribeBlob(blob)
      if (!listeningRef.current || mutedRef.current) return
      if (text) submitFinal(text)
    } catch {
      // Transient turn failure (endpoint down, timeout): stay silent and
      // keep listening instead of breaking the whole voice session.
    } finally {
      transcribingRef.current = false
      if (listeningRef.current && !mutedRef.current) {
        setRecState('listening')
        startCycle()
      }
    }
  }, [setRecState, startCycle, submitFinal, transcribeBlob])

  const endCycle = useCallback(
    (discard: boolean) => {
      const recorder = recorderRef.current
      recorderRef.current = null
      if (!recorder) return
      discardRef.current = discardRef.current || discard
      try {
        if (recorder.state !== 'inactive') recorder.stop()
        else void finishCycle()
      } catch {
        void finishCycle()
      }
    },
    [finishCycle]
  )

  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser || levelTimerRef.current !== null) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    // 10 Hz polling (not rAF): deterministic in every browser AND in tests,
    // still smooth enough for the Orb, and it doubles as the VAD clock.
    levelTimerRef.current = setInterval(() => {
      if (!listeningRef.current) return
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const level = Math.min(1, sum / data.length / 80)
      callbacksRef.current.onAudioLevel?.(level)
      // Energy VAD: speech starts a turn, sustained silence ends it.
      const cycling =
        recorderRef.current !== null &&
        !mutedRef.current &&
        !transcribingRef.current
      if (cycling) {
        const now = Date.now()
        if (level > VAD_SPEECH_THRESHOLD) {
          hadSpeechRef.current = true
          lastSpeechRef.current = now
        } else if (
          hadSpeechRef.current &&
          lastSpeechRef.current > 0 &&
          now - lastSpeechRef.current > VAD_SILENCE_END_MS
        ) {
          // NOTE: do NOT clear hadSpeechRef here — finishCycle (fired from
          // the async onstop event) still needs it to decide transcribe vs
          // restart. Clearing first silently drops every turn.
          endCycle(false)
        } else if (now - cycleStartRef.current > MAX_RECORD_MS) {
          endCycle(false)
        }
      }
    }, 100)
  }, [callbacksRef, endCycle])

  const start = useCallback(async () => {
    if (listeningRef.current) return true
    if (!mediaSupport()) {
      setRecState('unsupported')
      return false
    }
    mutedRef.current = false
    transcribingRef.current = false
    discardRef.current = false
    try {
      setRecState('connecting')
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new Ctx()
        }
        if (audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume()
        }
        const source = audioCtxRef.current.createMediaStreamSource(
          streamRef.current
        )
        analyserRef.current = audioCtxRef.current.createAnalyser()
        analyserRef.current.fftSize = 256
        analyserRef.current.smoothingTimeConstant = 0.6
        source.connect(analyserRef.current)
      }
      listeningRef.current = true
      startLevelLoop()
      startCycle()
      setRecState('listening')
      return true
    } catch {
      listeningRef.current = false
      teardownAudio()
      setRecState('denied')
      callbacksRef.current.onError?.(
        'Microphone access was denied. Allow it in the browser settings, then reopen voice mode.'
      )
      return false
    }
  }, [callbacksRef, setRecState, startCycle, startLevelLoop, teardownAudio])

  const stop = useCallback(() => {
    listeningRef.current = false
    mutedRef.current = false
    transcribingRef.current = false
    discardRef.current = true
    if (recorderRef.current) {
      const recorder = recorderRef.current
      recorderRef.current = null
      try {
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
    }
    teardownAudio()
    if (stateRef.current !== 'idle') setRecState('idle')
  }, [setRecState, teardownAudio])

  /**
   * Mute stops the current cycle silently (no TTS echo transcribed) and
   * unmute opens a fresh one. No system beep anywhere: MediaRecorder never
   * plays one, on any device.
   */
  const setMuted = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted
      if (muted) {
        endCycle(true)
      } else if (
        listeningRef.current &&
        !recorderRef.current &&
        !transcribingRef.current
      ) {
        startCycle()
      }
    },
    [endCycle, startCycle]
  )

  const setLanguage = useCallback((nextLocale: string) => {
    // Kept for API stability. The endpoint auto-detects the spoken language,
    // so this is currently informational only.
    langRef.current = nextLocale ?? 'fr-FR'
  }, [])

  useEffect(() => {
    setLanguage(locale)
  }, [locale, setLanguage])

  useEffect(() => stop, [stop])

  return { state, start, stop, setMuted, setLanguage }
}
