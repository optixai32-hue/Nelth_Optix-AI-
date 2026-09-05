'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

import { useI18n } from '../i18n-provider'

import type {
  ConnectorId,
  ConnectorProviderId,
  ConnectorService,
  ConnectorStatus
} from './use-connectors'

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'
const OPEN_MS = 220
const CLOSE_MS = 200

export interface ConnectorPanelProps {
  open: boolean
  onClose: () => void
  services: ConnectorService[]
  statuses: Record<ConnectorId, ConnectorStatus>
  connectedIds: ConnectorId[]
  configured: Record<ConnectorProviderId, boolean>
  needsReconnect?: Record<ConnectorProviderId, boolean>
  providerForService: (id: ConnectorId) => ConnectorProviderId
  onConnect: (id: ConnectorId) => Promise<boolean>
  onDisconnect: (provider: ConnectorProviderId) => Promise<void>
  onConnected: () => void
  onError: () => void
}

function RowSpinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 animate-spin text-neutral-500"
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

/**
 * OAuth / connector picker panel. Backdrop fades in; the sheet animates with
 * fade + slight upward motion (180–250ms). Closing reverses the animation
 * before unmounting. Each service row carries its own idle → connecting →
 * connected / error (retry) micro-flow with stable widths (no layout shift).
 */
export function ConnectorPanel({
  open,
  onClose,
  services,
  statuses,
  connectedIds,
  configured,
  needsReconnect,
  providerForService,
  onConnect,
  onDisconnect,
  onConnected,
  onError
}: ConnectorPanelProps) {
  const { t } = useI18n()
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)
  const [busyId, setBusyId] = useState<ConnectorId | null>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      setClosing(false)
      setRendered(true)
    } else if (rendered) {
      setClosing(true)
      closeTimer.current = window.setTimeout(() => {
        setRendered(false)
        setClosing(false)
      }, CLOSE_MS)
    }
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  useEffect(() => {
    if (!rendered || closing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rendered, closing, onClose ])

  const handleConnect = useCallback(
    async (id: ConnectorId) => {
      if (busyId) return
      setBusyId(id)
      try {
        const ok = await onConnect(id)
        if (ok) onConnected()
        else onError()
      } catch {
        onError()
      } finally {
        setBusyId(null)
      }
    },
    [busyId, onConnect, onConnected, onError]
  )

  if (!rendered || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('connector.panelTitle')}
      data-testid="connector-panel"
    >
      <button
        type="button"
        aria-label={t('connector.close')}
        data-testid="connector-panel-backdrop"
        onClick={onClose}
        className={cn(
          'absolute inset-0 cursor-default bg-black/40 transition-opacity duration-200',
          closing ? 'opacity-0' : 'opacity-100',
          EASE
        )}
      />
      <div
        className={cn(
          'relative w-full max-w-[420px] rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)]',
          closing ? 'nelth-connector-panel-leave' : 'nelth-connector-panel-enter'
        )}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-neutral-900">
              {t('connector.panelTitle')}
            </h2>
            <p className="mt-0.5 text-[13px] leading-[18px] text-neutral-500">
              {t('connector.panelSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('connector.close')}
            data-testid="connector-panel-close"
            className={cn(
              'grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-500 transition-all duration-150 hover:bg-neutral-100 hover:text-neutral-800 active:scale-95',
              EASE
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden="true">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {services.map(service => {
            const isConnected = connectedIds.includes(service.id)
            const status: ConnectorStatus = isConnected
              ? 'connected'
              : (statuses[service.id] ?? 'idle')
            const busy = busyId === service.id
            const provider = providerForService(service.id)
            const isConfigured = configured[provider] !== false
            const expired = needsReconnect?.[provider] === true
            return (
              <li
                key={service.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5 transition-colors duration-150 hover:border-neutral-200 hover:bg-neutral-50"
              >
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
                  <service.Icon className="size-8" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-neutral-900">
                    {service.name}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-500">
                    {service.detail}
                  </span>
                </span>
                {status === 'connected' && expired ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleConnect(service.id)}
                      data-testid={`connector-reconnect-${service.id}`}
                      title={t('connector.reconnectHint')}
                      className={cn(
                        'inline-flex min-w-[6.5rem] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-100 px-3.5 py-1.5 text-[13px] font-medium text-amber-900',
                        'transition-all duration-150 hover:bg-amber-200 active:scale-[0.98] disabled:cursor-default',
                        EASE
                      )}
                    >
                      {busy ? (
                        <RowSpinner />
                      ) : (
                        t('connector.reconnect')
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusyId(service.id)
                          try {
                            await onDisconnect(provider)
                          } finally {
                            setBusyId(null)
                          }
                        })()
                      }
                      data-testid={`connector-disconnect-${service.id}`}
                      title={t('connector.revokeNote')}
                      className={cn(
                        'shrink-0 cursor-pointer rounded-full px-2 py-1.5 text-[12px] font-medium text-neutral-400 transition-all duration-150 hover:bg-neutral-100 hover:text-neutral-700 active:scale-95 disabled:cursor-default',
                        EASE
                      )}
                    >
                      {t('connector.disconnect')}
                    </button>
                  </span>
                ) : status === 'connected' ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      data-testid={`connector-status-${service.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="size-3.5"
                        aria-hidden="true"
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
                      {t('connector.connected')}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusyId(service.id)
                          try {
                            await onDisconnect(
                              providerForService(service.id)
                            )
                          } finally {
                            setBusyId(null)
                          }
                        })()
                      }
                      data-testid={`connector-disconnect-${service.id}`}
                      title={t('connector.revokeNote')}
                      className={cn(
                        'shrink-0 cursor-pointer rounded-full px-2 py-1.5 text-[12px] font-medium text-neutral-400 transition-all duration-150 hover:bg-neutral-100 hover:text-neutral-700 active:scale-95 disabled:cursor-default',
                        EASE
                      )}
                    >
                      {t('connector.disconnect')}
                    </button>
                  </span>
                ) : !isConfigured ? (
                  <span
                    data-testid={`connector-unconfigured-${service.id}`}
                    title={t('connector.notConfigured')}
                    className="inline-flex min-w-[6.5rem] shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-full bg-neutral-50 px-3.5 py-1.5 text-[13px] font-medium text-neutral-400"
                  >
                    {t('connector.notConfigured')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleConnect(service.id)}
                    data-testid={`connector-service-${service.id}`}
                    className={cn(
                      'inline-flex min-w-[6.5rem] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-neutral-100 px-3.5 py-1.5 text-[13px] font-medium text-neutral-900',
                      'transition-all duration-150 hover:bg-neutral-200 active:scale-[0.98] disabled:cursor-default',
                      status === 'error' &&
                        'bg-red-50 text-red-700 hover:bg-red-100',
                      EASE
                    )}
                  >
                    {busy ? (
                      <RowSpinner />
                    ) : status === 'error' ? (
                      t('connector.retry')
                    ) : (
                      t('connector.connect')
                    )}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body
  )
}
