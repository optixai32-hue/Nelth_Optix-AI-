'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { stripMarkdownForSpeech } from './speech-text'

/**
 * Speaks assistant answers through the app TTS route
 * (POST /api/voice/speak → Edge neural voices, audio/mpeg).
 */
export function useVoiceTts(locale: string) {
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const localeRef = useRef(locale)
  localeRef.current = locale

  const stop = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause()
      } catch {
        /* ignore */
      }
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    async (markdown: string): Promise<boolean> => {
      const text = stripMarkdownForSpeech(markdown)
      if (!text) return false
      stop()
      try {
        const res = await fetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, locale: localeRef.current })
        })
        if (!res.ok) return false
        const buffer = await res.arrayBuffer()
        if (buffer.byteLength === 0) return false
        const url = URL.createObjectURL(
          new Blob([buffer], { type: 'audio/mpeg' })
        )
        objectUrlRef.current = url
        const audio = new Audio(url)
        audioRef.current = audio
        setSpeaking(true)
        await new Promise<void>(resolve => {
          audio.onended = () => resolve()
          audio.onerror = () => resolve()
          audio.play().catch(() => resolve())
        })
        return true
      } catch {
        return false
      } finally {
        stop()
      }
    },
    [stop]
  )

  useEffect(() => stop, [stop])

  return { speaking, speak, stop }
}
