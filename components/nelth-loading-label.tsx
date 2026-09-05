'use client'

import { useEffect, useState } from 'react'

import { useI18n } from './i18n-provider'

/**
 * Rotating loading label shown next to the AnimatedLogo while any model is
 * generating a response.
 *
 * Cycles through three short generic messages with a shimmer gradient
 * animation (ChatGPT/Gemini-style), giving the user feedback that the model
 * is actively working — especially useful when tools run for a second or two
 * before the first token arrives.
 *
 * When `activity` is set (e.g. "Connexion à Gmail…"), it is shown INSTEAD of
 * the rotating phases so the user sees exactly what is happening right now.
 *
 * Displayed ONLY while status === 'submitted' | 'streaming' and before any
 * text has been streamed yet (handled by the parent ChatMessages component).
 */

const PHASE_KEYS = [
  'loading.phase1',
  'loading.phase2',
  'loading.phase3',
] as const

export function NelthLoadingLabel({ activity }: { activity?: string | null }) {
  const { t } = useI18n()
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out, swap message, fade in
      setVisible(false)
      const swap = setTimeout(() => {
        setPhaseIdx(p => (p + 1) % PHASE_KEYS.length)
        setVisible(true)
      }, 260)
      return () => clearTimeout(swap)
    }, 1900)

    return () => clearInterval(interval)
  }, [])

  return (
    <span
      aria-live="polite"
      aria-label={activity || t('loading.thinking')}
      className="text-sm select-none"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 220ms ease',
        /* Shimmer gradient text — uses the same @keyframes shimmer already
           defined in app/globals.css (inside @theme inline).             */
        background:
          'linear-gradient(110deg, var(--color-muted-foreground) 30%, var(--color-foreground) 50%, var(--color-muted-foreground) 70%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        animation: 'shimmer 1.6s linear infinite',
      }}
    >
      {activity || t(PHASE_KEYS[phaseIdx])}
    </span>
  )
}
