'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDriveIcon,
  NotionIcon
} from './connector-icons'

export type ConnectorId =
  | 'drive'
  | 'gmail'
  | 'calendar'
  | 'github'
  | 'notion'

export type ConnectorProviderId = 'google' | 'github' | 'notion'

export interface ConnectorService {
  id: ConnectorId
  name: string
  detail: string
  Icon: (props: { className?: string }) => React.ReactElement
}

export const CONNECTOR_SERVICES: ConnectorService[] = [
  {
    id: 'drive',
    name: 'Google Drive',
    detail: 'Files and folders',
    Icon: GoogleDriveIcon
  },
  {
    id: 'gmail',
    name: 'Gmail',
    detail: 'Send and read mail',
    Icon: GmailIcon
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    detail: 'Events and scheduling',
    Icon: GoogleCalendarIcon
  },
  {
    id: 'github',
    name: 'GitHub',
    detail: 'Repos and pull requests',
    Icon: GitHubIcon
  },
  {
    id: 'notion',
    name: 'Notion',
    detail: 'Docs and databases',
    Icon: NotionIcon
  }
]

export type ConnectorStatus = 'idle' | 'connecting' | 'connected' | 'error'

export function providerForService(id: ConnectorId): ConnectorProviderId {
  if (id === 'github') return 'github'
  if (id === 'notion') return 'notion'
  return 'google'
}

const EMPTY_STATUSES: Record<ConnectorId, ConnectorStatus> = {
  drive: 'idle',
  gmail: 'idle',
  calendar: 'idle',
  github: 'idle',
  notion: 'idle'
}

export interface ConnectorServerState {
  connected: Record<ConnectorId, boolean>
  configured: Record<ConnectorProviderId, boolean>
  guest: boolean
}

async function fetchServerState(): Promise<ConnectorServerState | null> {
  try {
    const res = await fetch('/api/connectors/status', { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<ConnectorServerState>
    if (!data || typeof data.connected !== 'object') return null
    return {
      connected: {
        drive: !!data.connected.drive,
        gmail: !!data.connected.gmail,
        calendar: !!data.connected.calendar,
        github: !!data.connected.github,
        notion: !!data.connected.notion
      },
      configured: {
        google: !!data.configured?.google,
        github: !!data.configured?.github,
        notion: !!data.configured?.notion
      },
      guest: !!data.guest
    }
  } catch {
    return null
  }
}

export interface UseConnectorsOptions {
  /**
   * Custom connect implementation (tests). Replaces the popup OAuth flow;
   * must resolve on success and reject on failure. Server state is NOT
   * refreshed in this mode so tests stay hermetic.
   */
  connectImpl?: (id: ConnectorId) => Promise<void>
  /** Popup result timeout (ms). Lower it in tests. */
  popupTimeoutMs?: number
}

function waitForPopupResult(
  provider: ConnectorProviderId,
  popup: Window | null,
  timeoutMs: number
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      window.clearInterval(poller)
      try {
        popup?.close()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as {
        type?: unknown
        provider?: unknown
      } | null
      if (!data || typeof data !== 'object') return
      if (data.provider !== provider) return
      if (data.type === 'nelth-connector-connected') finish(true)
      else if (data.type === 'nelth-connector-error') finish(false)
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => finish(false), timeoutMs)
    const poller = window.setInterval(() => {
      try {
        if (!popup || popup.closed) {
          window.clearInterval(poller)
          finish(false)
        }
      } catch {
        window.clearInterval(poller)
        finish(false)
      }
    }, 1000)
  })
}

/**
 * Real connector state, backed by the server OAuth vault.
 *
 * - Source of truth is `/api/connectors/status` (sealed server tokens, never
 *   exposed to the browser — only booleans travel over the wire).
 * - Connecting opens a popup on our authorize route; the callback page
 *   postMessages the result back, the popup closes, state refreshes.
 * - Card dismissal stays session-only (plain React state): closing the card
 *   hides it for the current view, but it comes back on refresh — otherwise
 *   the user could never reach the connector panel again.
 */
export function useConnectors(options: UseConnectorsOptions = {}) {
  const { connectImpl, popupTimeoutMs = 120000 } = options
  const [connectedIds, setConnectedIds] = useState<ConnectorId[]>([])
  const [statuses, setStatuses] = useState<Record<ConnectorId, ConnectorStatus>>(
    () => ({ ...EMPTY_STATUSES })
  )
  const [configured, setConfigured] = useState<
    Record<ConnectorProviderId, boolean>
  >(() => ({ google: true, github: true, notion: true }))
  const [guest, setGuest] = useState<boolean>(false)
  const [dismissed, setDismissed] = useState<boolean>(false)

  const setStatus = useCallback((id: ConnectorId, status: ConnectorStatus) => {
    setStatuses(prev => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  const applyServerState = useCallback((state: ConnectorServerState) => {
    const ids = CONNECTOR_SERVICES.filter(s => state.connected[s.id]).map(
      s => s.id
    )
    setConnectedIds(ids)
    setStatuses(prev => {
      const next = { ...prev }
      for (const id of CONNECTOR_SERVICES.map(s => s.id)) {
        // Never clobber an in-flight connecting/error state.
        if (next[id] === 'connecting') continue
        next[id] = state.connected[id] ? 'connected' : 'idle'
      }
      return next
    })
    setConfigured(state.configured)
    setGuest(state.guest)
  }, [])

  const refresh = useCallback(async () => {
    const state = await fetchServerState()
    if (state) applyServerState(state)
  }, [applyServerState])

  useEffect(() => {
    let cancelled = false
    // Initial hydration from the server vault (async continuation, not a
    // synchronous set-state — safe in an effect).
    fetchServerState().then(
      state => {
        if (!cancelled && state) applyServerState(state)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [applyServerState])

  const connect = useCallback(
    async (id: ConnectorId) => {
      // Test seam (and legacy behavior): no popup, no server round-trip.
      if (connectImpl) {
        setStatus(id, 'connecting')
        try {
          await connectImpl(id)
          setStatus(id, 'connected')
          setConnectedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
          return true
        } catch {
          setStatus(id, 'error')
          return false
        }
      }
      const provider = providerForService(id)
      setStatus(id, 'connecting')
      let popup: Window | null = null
      try {
        popup = window.open(
          `/api/connectors/authorize?provider=${provider}`,
          'nelth-oauth',
          'width=520,height=680'
        )
      } catch {
        popup = null
      }
      if (!popup) {
        setStatus(id, 'error')
        return false
      }
      const ok = await waitForPopupResult(provider, popup, popupTimeoutMs)
      if (ok) {
        await refresh()
        // Belt and braces in case the refresh races the vault write.
        setStatus(id, 'connected')
        setConnectedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
        return true
      }
      setStatus(id, 'error')
      return false
    },
    [connectImpl, popupTimeoutMs, refresh, setStatus]
  )

  const disconnect = useCallback(
    async (provider: ConnectorProviderId) => {
      try {
        await fetch('/api/connectors/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider })
        })
      } catch {
        /* ignore — refresh decides the truth */
      }
      await refresh()
      const affected = CONNECTOR_SERVICES.filter(
        s => providerForService(s.id) === provider
      ).map(s => s.id)
      setStatuses(prev => {
        const next = { ...prev }
        for (const id of affected) {
          if (next[id] !== 'connecting') next[id] = 'idle'
        }
        return next
      })
      setConnectedIds(prev => prev.filter(id => !affected.includes(id)))
    },
    [refresh]
  )

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  return {
    services: CONNECTOR_SERVICES,
    connectedIds,
    connectedCount: connectedIds.length,
    statuses,
    configured,
    guest,
    dismissed,
    connect,
    disconnect,
    refresh,
    dismiss
  }
}
