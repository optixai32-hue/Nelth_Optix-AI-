'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { captureClient } from '@/lib/analytics/posthog-client'
import { cn } from '@/lib/utils'

import { useI18n } from '../i18n-provider'
import { ConnectorPanel } from './connector-panel'
import {
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDriveIcon
} from './connector-icons'
import { useConnectors } from './use-connectors'

type CardPhase =
  | 'entering'
  | 'idle'
  | 'connecting'
  | 'success'
  | 'error'
  | 'leaving'

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'
const ENTER_MS = 220
const LEAVE_MS = 200
const PRESS_MS = 130

export interface ConnectorCardProps {
  className?: string
  /** Shortens simulated timings (tests). */
  timings?: { pressMs?: number }
  /** Custom connect implementation (tests / future real OAuth). */
  connectImpl?: (id: Parameters<ReturnType<typeof useConnectors>['connect']>[0]) => Promise<void>
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4 animate-spin', className)}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="nelth-check-draw"
      />
    </svg>
  )
}

/**
 * Native chatbot Connector Card (empty-state, below the quick-action chips).
 *
 * Horizontal card: service icons | title + description | pill button, with a
 * dismiss cross partly outside the top-right corner. Full chatbot-grade
 * interaction system: press scaling, stable-width loading, success pulse,
 * subtle error shake, animated dismiss, animated OAuth panel.
 */
export function ConnectorCard({ className, timings, connectImpl }: ConnectorCardProps) {
  const { t } = useI18n()
  const {
    services,
    connectedIds,
    connectedCount,
    statuses,
    dismissed,
    connect,
    dismiss
  } = useConnectors(connectImpl ? { connectImpl } : undefined)

  const [phase, setPhase] = useState<CardPhase>('entering')
  const [panelOpen, setPanelOpen] = useState(false)
  const [pulseKey, setPulseKey] = useState(0)
  const [shakeKey, setShakeKey] = useState(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const id = window.setTimeout(() => setPhase('idle'), ENTER_MS)
    timers.current.push(id)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  const handleDismiss = useCallback(() => {
    setPhase('leaving')
    try {
      captureClient('connector_card_dismissed', {})
    } catch {
      /* ignore */
    }
    later(() => dismiss(), LEAVE_MS)
  }, [dismiss, later])

  const openPanel = useCallback(() => setPanelOpen(true), [])

  const handleConnectClick = useCallback(() => {
    if (phase === 'connecting') return
    try {
      captureClient('connector_card_connect_clicked', {})
    } catch {
      /* ignore */
    }
    // Pressed state (scale handled by CSS), then loading.
    later(() => {
      setPhase('connecting')
      // Brief loading beat, then open the connector panel (no layout shift:
      // the button keeps a stable min-width the whole time).
      later(() => {
        setPhase(connectedCount > 0 ? 'success' : 'idle')
        openPanel()
      }, 650)
    }, timings?.pressMs ?? PRESS_MS)
  }, [connectedCount, later, openPanel, phase, timings?.pressMs])

  const handleConnectedInPanel = useCallback(() => {
    setPulseKey(k => k + 1)
    setPhase('success')
    try {
      captureClient('connector_connected', {})
    } catch {
      /* ignore */
    }
  }, [])

  const handlePanelError = useCallback(() => {
    setShakeKey(k => k + 1)
    setPhase('error')
  }, [])

  const handleRetry = useCallback(() => {
    setPhase('idle')
    openPanel()
  }, [openPanel])

  if (dismissed) return null

  const connected = connectedCount > 0
  const buttonLabel =
    phase === 'connecting'
      ? t('connector.connecting')
      : phase === 'error'
        ? t('connector.retry')
        : phase === 'success' || connected
          ? t('connector.connected')
          : t('connector.connect')

  const shownIcons = connected
    ? services.filter(s => connectedIds.includes(s.id)).slice(0, 3)
    : null

  return (
    <>
      <div
        role="region"
        aria-label={t('connector.title')}
        className={cn(
          'nelth-connector-card relative w-full max-w-[530px] rounded-2xl border border-neutral-200 bg-white px-4 py-[14px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]',
          phase === 'entering' && 'nelth-connector-enter',
          phase === 'leaving' && 'nelth-connector-leave',
          className
        )}
        key={pulseKey === 0 && shakeKey === 0 ? 'card' : `card-${pulseKey}-${shakeKey}`}
        data-testid="connector-card"
        data-phase={phase}
      >
        <div
          key={`fx-${pulseKey}-${shakeKey}`}
          className={cn(
            pulseKey > 0 && 'nelth-connector-pulse',
            shakeKey > 0 && phase === 'error' && 'nelth-connector-shake'
          )}
        >
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('connector.dismiss')}
            data-testid="connector-dismiss"
            className={cn(
              'absolute -right-2.5 -top-2.5 grid size-6 cursor-pointer place-items-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_2px_8px_rgba(0,0,0,0.12)]',
              'transition-all duration-150 hover:text-neutral-800 hover:shadow-[0_2px_10px_rgba(0,0,0,0.18)] active:scale-95',
              EASE
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-[14px]">
            <div className="flex items-center gap-[14px] min-w-0 flex-1">
              <div
                className="relative grid size-12 shrink-0 place-items-center"
                aria-hidden="true"
              >
                {shownIcons ? (
                  <span className="flex -space-x-3">
                    {shownIcons.map(s => (
                      <span
                        key={s.id}
                        className="grid size-9 place-items-center overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
                      >
                        <s.Icon className="size-7" />
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="relative block size-12">
                    <GmailIcon className="absolute left-0 top-1 size-9 opacity-95" />
                    <GoogleCalendarIcon className="absolute right-0 top-1 size-9 opacity-95" />
                    <GoogleDriveIcon className="absolute bottom-0 left-1/2 size-10 -translate-x-1/2 drop-shadow-sm" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold leading-6 text-neutral-900">
                  {t('connector.title')}
                </p>
                <p className="nelth-connector-desc mt-0.5 line-clamp-3 text-[13px] leading-[18px] text-neutral-500">
                  {t('connector.description')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={phase === 'error' ? handleRetry : handleConnectClick}
              disabled={phase === 'connecting'}
              data-testid="connector-connect"
              className={cn(
                'inline-flex min-w-[8rem] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-neutral-100 px-4 py-2.5 text-[14px] font-medium text-neutral-900',
                'transition-all duration-150 hover:bg-neutral-200 active:scale-[0.98]',
                'disabled:cursor-default',
                'sm:ml-5',
                EASE
              )}
            >
              <span className="grid flex-1 place-items-center">
                <span
                  className={cn(
                    'col-start-1 row-start-1 transition-opacity duration-150',
                    phase === 'connecting' ? 'opacity-0' : 'opacity-100'
                  )}
                >
                  {phase === 'success' || (connected && phase !== 'error') ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CheckMark />
                      {buttonLabel}
                    </span>
                  ) : (
                    buttonLabel
                  )}
                </span>
                <span
                  className={cn(
                    'col-start-1 row-start-1 inline-flex items-center gap-2 transition-opacity duration-150',
                    phase === 'connecting' ? 'opacity-100' : 'opacity-0'
                  )}
                  aria-hidden={phase !== 'connecting'}
                >
                  <Spinner />
                  {t('connector.connecting')}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <ConnectorPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        services={services}
        statuses={statuses}
        connectedIds={connectedIds}
        onConnect={connect}
        onConnected={handleConnectedInPanel}
        onError={handlePanelError}
      />
    </>
  )
}
