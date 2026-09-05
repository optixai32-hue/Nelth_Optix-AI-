'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceRecState =
  | 'idle'
  | 'listening'
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

interface RecognitionCtor {
  new (): any
}

function getRecognitionClass(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const Cls = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return (typeof Cls === 'function' ? Cls : null) as RecognitionCtor | null
}

/** True when the browser can do in-browser speech recognition at all. */
export function isVoiceRecognitionSupported(): boolean {
  return getRecognitionClass() !== null
}

const SILENCE_SUBMIT_MS = 1200
const FINAL_SUBMIT_MS = 400
const RESTART_DELAY_MS = 150
const MAX_RESTARTS_PER_WINDOW = 5
const RESTART_WINDOW_MS = 3000

/**
 * Continuous Web Speech recognition for the voice mode.
 *
 * One session = ONE recognition.start(). This is the whole "no beep on
 * every listen" strategy: on Android, Chrome plays an OS-level beep each
 * time recognition starts and no web page can suppress it — so we start
 * once when voice mode opens and keep the session alive, muting (ignoring
 * results) while the AI thinks or speaks instead of stopping/restarting.
 * The beep then fires at most once per voice session, on every device,
 * with zero server STT involved.
 */
export function useVoiceRecognition(
  callbacksRef: React.MutableRefObject<VoiceRecognitionCallbacks>,
  locale: string
) {
  const [state, setState] = useState<VoiceRecState>('idle')
  const recognitionRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelFrameRef = useRef<number | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listeningRef = useRef(false)
  const mutedRef = useRef(false)
  const langRef = useRef('fr-FR')
  const restartStampsRef = useRef<number[]>([])
  const stateRef = useRef<VoiceRecState>('idle')

  const setRecState = useCallback(
    (next: VoiceRecState) => {
      stateRef.current = next
      setState(next)
      callbacksRef.current.onStateChange(next)
    },
    [callbacksRef]
  )

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const submitFinal = useCallback(
    (text: string) => {
      const clean = text.trim()
      clearSilenceTimer()
      if (!clean) return
      callbacksRef.current.onFinalText(clean)
    },
    [callbacksRef, clearSilenceTimer]
  )

  const stopLevelLoop = useCallback(() => {
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current)
      levelFrameRef.current = null
    }
  }, [])

  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!listeningRef.current) return
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const level = Math.min(1, sum / data.length / 80)
      callbacksRef.current.onAudioLevel?.(level)
      levelFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [callbacksRef])

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

  const beginRecognition = useCallback(() => {
    const Cls = getRecognitionClass()
    if (!Cls) return
    try {
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
        clearSilenceTimer()
        // Final token → quick submit; interim only → wait for a real pause.
        silenceTimerRef.current = setTimeout(
          () => submitFinal(finalText || current),
          finalText ? FINAL_SUBMIT_MS : SILENCE_SUBMIT_MS
        )
      }

      recognition.onerror = (event: any) => {
        const code = event?.error as string | undefined
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          listeningRef.current = false
          setRecState('denied')
          callbacksRef.current.onError?.(
            'Microphone access was denied. Allow it in the browser settings, then reopen voice mode.'
          )
        }
        // 'aborted', 'no-speech', 'network', 'audio-capture': the onend
        // auto-restart below recovers transparently — stay silent.
      }

      recognition.onend = () => {
        if (!listeningRef.current || mutedRef.current) return
        // Auto-restart the continuous session (Chrome ends it after ~1 min
        // or on network blips). Guard against hot restart loops.
        const now = Date.now()
        restartStampsRef.current = restartStampsRef.current.filter(
          t => now - t < RESTART_WINDOW_MS
        )
        if (restartStampsRef.current.length >= MAX_RESTARTS_PER_WINDOW) {
          listeningRef.current = false
          setRecState('error')
          callbacksRef.current.onError?.(
            'Speech recognition keeps stopping. Check your connection, then reopen voice mode.'
          )
          return
        }
        restartStampsRef.current.push(now)
        window.setTimeout(() => {
          if (listeningRef.current && !mutedRef.current) {
            try {
              recognitionRef.current?.start()
            } catch {
              /* already started — ignore */
            }
          }
        }, RESTART_DELAY_MS)
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch {
      listeningRef.current = false
      setRecState('error')
    }
  }, [callbacksRef, clearSilenceTimer, setRecState, submitFinal])

  const start = useCallback(async () => {
    if (listeningRef.current) return true
    if (!getRecognitionClass()) {
      setRecState('unsupported')
      return false
    }
    mutedRef.current = false
    restartStampsRef.current = []
    try {
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
      beginRecognition()
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
  }, [
    beginRecognition,
    setRecState,
    startLevelLoop,
    teardownAudio,
    callbacksRef
  ])

  const stop = useCallback(() => {
    listeningRef.current = false
    mutedRef.current = false
    clearSilenceTimer()
    restartStampsRef.current = []
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null
        recognitionRef.current.stop()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
    teardownAudio()
    if (stateRef.current !== 'idle') setRecState('idle')
  }, [clearSilenceTimer, setRecState, teardownAudio])

  /** Ignore mic results without killing the session (no restart = no beep). */
  const setMuted = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted
      if (muted) clearSilenceTimer()
    },
    [clearSilenceTimer]
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
