'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { X as XIcon } from 'lucide-react'
import type { OrbState } from 'orb-ui'
import { Orb } from 'orb-ui'

import type { UIMessage } from '@/lib/types/ai'
import { cn } from '@/lib/utils'
import { getTextFromParts } from '@/lib/utils/message-utils'

import { useI18n } from '../i18n-provider'

import { useVoiceRecognition } from './use-voice-recognition'

const EXIT_MS = 240

export interface VoiceModeProps {
  onClose: () => void
  onSubmitText: (text: string) => void
  messages: UIMessage[]
  status: 'submitted' | 'streaming' | 'ready' | 'error'
  locale: string
}

type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

export function VoiceMode({
  onClose,
  onSubmitText,
  messages,
  status: _status,
  locale
}: VoiceModeProps) {
  const { t } = useI18n()
  const [leaving, setLeaving] = useState(false)
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [interim, setInterim] = useState('')
  const [caption, setCaption] = useState('')
  const [fatal, setFatal] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)

  const closingRef = useRef(false)
  const phaseRef = useRef<VoicePhase>('idle')
  phaseRef.current = phase

  // Barge-in & Audio control refs
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioQueueRef = useRef<string[]>([])
  const isPlayingAudioRef = useRef(false)
  const activeAbortRef = useRef<AbortController | null>(null)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([])

  // Helper: Stop all audio and abort any active AI generation immediately (Barge-In)
  const bargeIn = useCallback(() => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause()
        currentAudioRef.current.currentTime = 0
      } catch {
        /* ignore */
      }
      currentAudioRef.current = null
    }
    // Revoke any queued audio URLs
    for (const url of audioQueueRef.current) {
      URL.revokeObjectURL(url)
    }
    audioQueueRef.current = []
    isPlayingAudioRef.current = false

    if (activeAbortRef.current) {
      activeAbortRef.current.abort()
      activeAbortRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    bargeIn()
    setLeaving(true)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose, bargeIn])

  // Sequentially play queued audio chunks
  const playNextAudio = useCallback((onAllFinished?: () => void) => {
    if (audioQueueRef.current.length === 0) {
      isPlayingAudioRef.current = false
      if (onAllFinished) onAllFinished()
      return
    }

    isPlayingAudioRef.current = true
    const nextUrl = audioQueueRef.current.shift()!
    const audio = new Audio(nextUrl)
    currentAudioRef.current = audio

    audio.onended = () => {
      URL.revokeObjectURL(nextUrl)
      currentAudioRef.current = null
      playNextAudio(onAllFinished)
    }

    audio.onerror = () => {
      URL.revokeObjectURL(nextUrl)
      currentAudioRef.current = null
      playNextAudio(onAllFinished)
    }

    audio.play().catch(() => {
      URL.revokeObjectURL(nextUrl)
      currentAudioRef.current = null
      playNextAudio(onAllFinished)
    })
  }, [])

  const callbacksRef = useRef({
    onInterimText: (_text: string) => {},
    onFinalText: (_text: string) => {},
    onStateChange: (_state: string) => {},
    onAudioLevel: (_level: number) => {},
    onError: (_message: string) => {}
  })

  // Barge-in: when user speaks while AI is thinking/speaking, cut immediately
  callbacksRef.current.onInterimText = (text: string) => {
    if (closingRef.current) return
    if (
      text.trim() &&
      (phaseRef.current === 'speaking' || isPlayingAudioRef.current)
    ) {
      bargeIn()
      setPhase('listening')
    }
    setInterim(text)
  }

  // Handle final user speech turn
  callbacksRef.current.onFinalText = async (text: string) => {
    if (closingRef.current || !text.trim()) return
    bargeIn()
    setInterim('')
    setCaption(text)
    setPhase('thinking')
    rec.setMuted(true)

    // Save to local conversation history for context
    historyRef.current.push({ role: 'user', text: text.trim() })

    // Also mirror to chat UI in background
    onSubmitText(text)

    const abortController = new AbortController()
    activeAbortRef.current = abortController

    try {
      // 1. Call dedicated Voice LLM (Nemotron-3-Nano-Omni / VOICE_ONLY_SYSTEM_PROMPT)
      const res = await fetch('/api/voice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          history: historyRef.current.slice(-6)
        }),
        signal: abortController.signal
      })

      if (!res.ok) {
        throw new Error(`Voice chat error HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream body from voice chat')

      const decoder = new TextDecoder()
      let fullAssistantText = ''
      let chunkBuffer = ''

      // Fetch and enqueue TTS for a clause
      const sendClauseToTts = async (clause: string) => {
        if (abortController.signal.aborted || !clause.trim()) return
        try {
          const ttsRes = await fetch('/api/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: clause.trim() }),
            signal: abortController.signal
          })
          if (!ttsRes.ok) return
          const audioBlob = await ttsRes.blob()
          if (abortController.signal.aborted || audioBlob.size === 0) return

          const url = URL.createObjectURL(audioBlob)
          audioQueueRef.current.push(url)

          if (!isPlayingAudioRef.current) {
            setPhase('speaking')
            playNextAudio(() => {
              // All spoken chunks done
              if (!abortController.signal.aborted && !closingRef.current) {
                setPhase('listening')
                rec.setMuted(false)
              }
            })
          }
        } catch {
          /* ignore aborted TTS */
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done || abortController.signal.aborted) break

        const delta = decoder.decode(value, { stream: true })
        if (!delta) continue

        fullAssistantText += delta
        chunkBuffer += delta
        setCaption(fullAssistantText)

        // Split streaming text on clauses / punctuation to trigger TTS immediately
        const match = chunkBuffer.match(/^([^,;.?!:\n]+[,;.?!:\n]+)(\s+|$)/)
        if (match && match[1].trim().length >= 2) {
          const clause = match[1].trim()
          chunkBuffer = chunkBuffer.slice(match[0].length)
          void sendClauseToTts(clause)
        } else {
          // Hard split if >= 8 words accumulate without punctuation
          const words = chunkBuffer.trim().split(/\s+/)
          if (words.length >= 8) {
            const clause = words.slice(0, 6).join(' ')
            chunkBuffer = words.slice(6).join(' ')
            void sendClauseToTts(clause)
          }
        }
      }

      // Flush remainder
      if (chunkBuffer.trim() && !abortController.signal.aborted) {
        await sendClauseToTts(chunkBuffer.trim())
      }

      if (fullAssistantText.trim()) {
        historyRef.current.push({
          role: 'assistant',
          text: fullAssistantText.trim()
        })
      }
    } catch (err: any) {
      if (abortController.signal.aborted) return
      console.error('[Voice Turn] Error:', err)
      setPhase('listening')
      rec.setMuted(false)
    }
  }

  callbacksRef.current.onStateChange = (state: string) => {
    if (closingRef.current) return
    if (state === 'connecting') {
      setPhase('connecting')
    } else if (
      state === 'listening' &&
      (phaseRef.current === 'idle' ||
        phaseRef.current === 'connecting' ||
        phaseRef.current === 'transcribing')
    ) {
      setPhase('listening')
    } else if (state === 'transcribing') {
      setPhase('transcribing')
    } else if (state === 'denied' || state === 'unsupported') {
      setPhase('error')
      setFatal(
        state === 'denied' ? t('voice.micDenied') : t('voice.unsupported')
      )
    } else if (state === 'error') {
      setPhase('error')
      setFatal(t('voice.recognitionError'))
    }
  }

  callbacksRef.current.onAudioLevel = (level: number) => {
    setMicLevel(level)
  }

  callbacksRef.current.onError = (message: string) => {
    if (closingRef.current) return
    setFatal(message)
  }

  const rec = useVoiceRecognition(callbacksRef, locale)

  // Start voice recognition on mount
  useEffect(() => {
    rec.start()
    return () => {
      bargeIn()
      rec.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = useCallback(() => {
    bargeIn()
    rec.stop()
    close()
  }, [rec, close, bargeIn])

  const orbState: OrbState =
    phase === 'connecting'
      ? 'connecting'
      : phase === 'listening'
        ? 'listening'
        : phase === 'thinking'
          ? 'thinking'
          : phase === 'speaking'
            ? 'speaking'
            : phase === 'error'
              ? 'error'
              : 'idle'

  const orbVolume =
    phase === 'listening'
      ? Math.max(0.08, micLevel)
      : phase === 'speaking'
        ? 0.75
        : phase === 'thinking' ||
            phase === 'connecting' ||
            phase === 'transcribing'
          ? 0.3
          : 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('voice.title')}
      data-testid="voice-mode"
      className={cn(
        'fixed inset-0 z-[120] flex flex-col items-center justify-center gap-6 bg-background/95 px-6 backdrop-blur-md',
        leaving ? 'nelth-voice-leave' : 'nelth-voice-enter'
      )}
    >
      <button
        type="button"
        onClick={handleClose}
        aria-label={t('voice.close')}
        data-testid="voice-close"
        className="absolute top-4 right-4 grid size-10 cursor-pointer place-items-center rounded-full border border-border bg-background text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95"
      >
        <XIcon className="size-5" />
      </button>

      <div>
        <Orb
          state={orbState}
          volume={orbVolume}
          theme="cloud"
          interactive={false}
          aria-label={t('voice.title')}
        />
      </div>

      <div className="flex min-h-[3.5rem] w-full max-w-xl flex-col items-center gap-2 text-center">
        {fatal ? (
          <p className="text-sm text-destructive">{fatal}</p>
        ) : (
          <>
            {caption && !interim ? (
              <p className="line-clamp-3 text-sm text-foreground/90">
                {caption}
              </p>
            ) : null}
            <p
              aria-live="polite"
              className={cn(
                'text-sm',
                interim ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {interim ||
                (phase === 'listening'
                  ? t('voice.listeningHint')
                  : phase === 'transcribing'
                    ? t('voice.transcribingHint')
                    : phase === 'connecting' || phase === 'idle'
                      ? t('voice.startingHint')
                      : phase === 'thinking'
                        ? t('voice.thinkingHint')
                        : phase === 'speaking'
                          ? 'Nelth parle...'
                          : t('voice.startingHint'))}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
