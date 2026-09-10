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
// 0.025 detects normal conversational voice levels (previous 0.12 was too high for standard microphones)
const VAD_SPEECH_THRESHOLD = 0.025
const VAD_SILENCE_END_MS = 750
const MAX_RECORD_MS = 30_000
const MIN_BLOB_BYTES = 200

function mediaSupport(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return false
  return (
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

function getRecognitionClass(): any {
  if (typeof window === 'undefined') return null
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
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
 * Microphone → Voice Recognition for Voice Mode.
 *
 * Combines Web Speech API (for real-time interim speech and instant transcription
 * in Chrome/Edge/Safari) with MediaRecorder + Energy VAD for full browser fallback.
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
  const recognitionRef = useRef<any>(null)
  const speechSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    // 1. In browser environment (non-test), try local Next.js Groq Whisper STT first
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
      try {
        const localFd = new FormData()
        localFd.append('file', blob, `speech.${extForMime(mimeRef.current)}`)
        localFd.append('audio', blob, `speech.${extForMime(mimeRef.current)}`)
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          body: localFd,
          signal: AbortSignal.timeout(STT_TIMEOUT_MS)
        })
        if (res.ok) {
          const data = await res.json().catch(() => null)
          const text = data?.text || data?.transcription?.text
          if (typeof text === 'string' && text.trim()) {
            return text.trim()
          }
        }
      } catch (groqErr) {
        console.warn('[STT] /api/voice/transcribe failed, using fallback:', groqErr)
      }
    }

    // 2. Space-Z STT / fallback endpoint
    try {
      const fallbackFd = new FormData()
      fallbackFd.append('audio', blob, `speech.${extForMime(mimeRef.current)}`)
      fallbackFd.append('file', blob, `speech.${extForMime(mimeRef.current)}`)
      const res = await fetch(`${STT_BASE}/api/transcribe`, {
        method: 'POST',
        body: fallbackFd,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`STT HTTP ${res.status}`)
      const data = (await res.json().catch(() => null)) as any
      const text = data?.transcription?.text || data?.text
      return typeof text === 'string' ? text.trim() : ''
    } catch {
      return ''
    }
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
      // Transient turn failure: stay silent and keep listening
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
    levelTimerRef.current = setInterval(() => {
      if (!listeningRef.current) return
      analyser.getByteFrequencyData(data)
      let sum = 0
      let voiceSum = 0
      const voiceBins = Math.min(data.length, 32)
      for (let i = 0; i < data.length; i++) {
        sum += data[i]
        if (i > 0 && i < voiceBins) voiceSum += data[i]
      }
      const generalLevel = Math.min(1, sum / data.length / 40)
      const voiceLevel =
        voiceBins > 1 ? Math.min(1, voiceSum / (voiceBins - 1) / 30) : 0
      const level = Math.max(generalLevel, voiceLevel)
      callbacksRef.current.onAudioLevel?.(level)

      // Energy VAD: speech starts a turn, sustained silence ends it.
      const cycling =
        recorderRef.current !== null &&
        !mutedRef.current &&
        !transcribingRef.current
      if (cycling) {
        const now = Date.now()
        const detectedSpeech = level > VAD_SPEECH_THRESHOLD
        if (detectedSpeech) {
          hadSpeechRef.current = true
          lastSpeechRef.current = now
        } else if (
          hadSpeechRef.current &&
          lastSpeechRef.current > 0 &&
          now - lastSpeechRef.current > VAD_SILENCE_END_MS
        ) {
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

      // Start Web Speech API for instant interim transcript & low-latency turns when available
      if (getRecognitionClass()) {
        try {
          const Cls = getRecognitionClass()
          const recognition = new Cls()
          recognition.continuous = true
          recognition.interimResults = true
          recognition.maxAlternatives = 1
          recognition.lang = langRef.current

          recognition.onresult = (event: any) => {
            if (mutedRef.current || !listeningRef.current) return
            let finalText = ''
            let interimText = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const transcript = event.results[i][0].transcript as string
              if (event.results[i].isFinal) finalText += transcript
              else interimText += transcript
            }
            const current = (finalText || interimText).trim()
            if (!current) return
            callbacksRef.current.onInterimText(current)

            if (speechSilenceTimerRef.current) {
              clearTimeout(speechSilenceTimerRef.current)
              speechSilenceTimerRef.current = null
            }

            speechSilenceTimerRef.current = setTimeout(
              () => {
                const textToSubmit = (finalText || current).trim()
                if (textToSubmit && listeningRef.current && !mutedRef.current) {
                  discardRef.current = true
                  hadSpeechRef.current = false
                  submitFinal(textToSubmit)
                }
              },
              finalText ? 500 : 750
            )
          }

          recognition.onerror = () => {
            /* ignore background speech recognition errors */
          }

          recognition.onend = () => {
            if (listeningRef.current && !mutedRef.current) {
              try {
                recognitionRef.current?.start()
              } catch {
                /* already running */
              }
            }
          }

          recognitionRef.current = recognition
          recognition.start()
        } catch {
          /* ignore Web Speech initialization issues */
        }
      }

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
  }, [callbacksRef, setRecState, startCycle, startLevelLoop, teardownAudio, submitFinal])

  const stop = useCallback(() => {
    listeningRef.current = false
    mutedRef.current = false
    transcribingRef.current = false
    discardRef.current = true
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current)
      speechSilenceTimerRef.current = null
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null
        recognitionRef.current.stop()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
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
   * unmute opens a fresh one.
   */
  const setMuted = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted
      if (speechSilenceTimerRef.current) {
        clearTimeout(speechSilenceTimerRef.current)
        speechSilenceTimerRef.current = null
      }
      if (muted) {
        endCycle(true)
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort()
          } catch {
            /* ignore */
          }
        }
      } else {
        if (
          listeningRef.current &&
          !recorderRef.current &&
          !transcribingRef.current
        ) {
          startCycle()
        }
        if (listeningRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start()
          } catch {
            /* ignore */
          }
        }
      }
    },
    [endCycle, startCycle]
  )

  const setLanguage = useCallback((nextLocale: string) => {
    const lower = (nextLocale ?? '').toLowerCase()
    const map: Record<string, string> = {
      fr: 'fr-FR',
      en: 'en-US',
      es: 'es-ES',
      de: 'de-DE',
      it: 'it-IT',
      ar: 'ar-SA'
    }
    const short = lower.split('-')[0]
    langRef.current = map[short] ?? 'fr-FR'
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = langRef.current
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    setLanguage(locale)
  }, [locale, setLanguage])

  useEffect(() => stop, [stop])

  return { state, start, stop, setMuted, setLanguage }
}

