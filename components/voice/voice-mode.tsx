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
import { useVoiceTts } from './use-voice-tts'

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
  | 'thinking'
  | 'speaking'
  | 'error'

function lastAssistantText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as unknown as { role?: string; parts?: unknown }
    if (m?.role === 'assistant' && Array.isArray(m.parts)) {
      try {
        const text = getTextFromParts(m.parts as never).trim()
        if (text) return text
      } catch {
        /* ignore */
      }
    }
  }
  return ''
}

/**
 * Full-screen voice takeover: Orb + continuous listen → chat → speak loop.
 *
 * - One recognition session per opening (no restart = no repeated beep,
 *   including Android where the OS beep is unsuppressible).
 * - Mic is muted (not stopped) while the AI thinks/speaks: no TTS echo,
 *   no session restart.
 * - X stops everything, plays the leave animation, then unmounts.
 */
export function VoiceMode({
  onClose,
  onSubmitText,
  messages,
  status,
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
  const awaitingReplyRef = useRef(false)
  const spokenForRef = useRef('')
  const phaseRef = useRef<VoicePhase>('idle')
  phaseRef.current = phase

  const { speak, stop: stopTts } = useVoiceTts(locale)

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setLeaving(true)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose])

  const callbacksRef = useRef({
    onInterimText: (_text: string) => {},
    onFinalText: (_text: string) => {},
    onStateChange: (_state: string) => {},
    onAudioLevel: (_level: number) => {},
    onError: (_message: string) => {}
  })

  callbacksRef.current.onInterimText = (text: string) => {
    if (closingRef.current) return
    setInterim(text)
  }
  callbacksRef.current.onFinalText = (text: string) => {
    if (closingRef.current || !text.trim()) return
    setInterim('')
    setCaption(text)
    awaitingReplyRef.current = true
    spokenForRef.current = ''
    setPhase('thinking')
    rec.setMuted(true)
    onSubmitText(text)
  }
  callbacksRef.current.onStateChange = (state: string) => {
    if (closingRef.current) return
    if (state === 'connecting') {
      setPhase('connecting')
    } else if (
      state === 'listening' &&
      (phaseRef.current === 'idle' || phaseRef.current === 'connecting')
    ) {
      setPhase('listening')
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

  // Open the single recognition session on mount.
  useEffect(() => {
    rec.start()
    return () => {
      rec.stop()
      stopTts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When the chat finishes answering our voice turn, speak the reply aloud,
  // then reopen the mic for the next turn.
  const replyText = useMemo(
    () => (awaitingReplyRef.current ? lastAssistantText(messages) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, status]
  )

  useEffect(() => {
    if (closingRef.current || !awaitingReplyRef.current) return
    if (status !== 'ready' || !replyText || spokenForRef.current === replyText)
      return
    spokenForRef.current = replyText
    awaitingReplyRef.current = false
    setPhase('speaking')
    setCaption(replyText)
    void (async () => {
      await speak(replyText)
      if (closingRef.current) return
      rec.setMuted(false)
      setInterim('')
      setPhase('listening')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyText, status])

  // While the chat works (submitted/streaming) show thinking.
  useEffect(() => {
    if (closingRef.current || !awaitingReplyRef.current) return
    if (status === 'submitted' || status === 'streaming') {
      setPhase('thinking')
    }
  }, [status])

  const handleClose = useCallback(() => {
    rec.stop()
    stopTts()
    close()
  }, [rec, stopTts, close])

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
        ? 0.55
        : phase === 'thinking' || phase === 'connecting'
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
                  : phase === 'connecting' || phase === 'idle'
                    ? t('voice.startingHint')
                    : phase === 'thinking'
                      ? t('voice.thinkingHint')
                      : phase === 'speaking'
                        ? t('voice.speakingHint')
                        : t('voice.startingHint'))}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
