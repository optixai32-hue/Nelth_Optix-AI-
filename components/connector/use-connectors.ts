'use client'

import { useCallback, useState } from 'react'

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

const CONNECTED_KEY = 'nelth.connectors.connected'

function readStoredIds(): ConnectorId[] {
  try {
    const raw = localStorage.getItem(CONNECTED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = new Set(CONNECTOR_SERVICES.map(s => s.id))
    return parsed.filter(
      (id): id is ConnectorId => typeof id === 'string' && valid.has(id as ConnectorId)
    )
  } catch {
    return []
  }
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

export interface UseConnectorsOptions {
  /** Simulated OAuth round-trip duration (ms). Lower it in tests. */
  connectDelayMs?: number
  /**
   * Custom connect implementation (tests / future real OAuth).
   * Must resolve on success and reject on failure.
   */
  connectImpl?: (id: ConnectorId) => Promise<void>
}

const defaultConnectImpl =
  (delayMs: number) =>
  async (_id: ConnectorId): Promise<void> => {
    await sleep(delayMs)
  }

/**
 * Connector state: which services are connected (persisted to localStorage
 * so connections survive reloads) plus per-service status. Card dismissal is
 * intentionally session-only (plain React state): closing the card hides it
 * for the current view, but it comes back on refresh — otherwise the user
 * could never reach the connector panel again.
 */
export function useConnectors(options: UseConnectorsOptions = {}) {
  const { connectDelayMs = 900, connectImpl } = options
  const [connectedIds, setConnectedIds] = useState<ConnectorId[]>(() =>
    typeof window === 'undefined' ? [] : readStoredIds()
  )
  const [statuses, setStatuses] = useState<Record<ConnectorId, ConnectorStatus>>(
    () => ({
      drive: 'idle',
      gmail: 'idle',
      calendar: 'idle',
      github: 'idle',
      notion: 'idle'
    })
  )
  const [dismissed, setDismissed] = useState<boolean>(false)

  const setStatus = useCallback((id: ConnectorId, status: ConnectorStatus) => {
    setStatuses(prev => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  const connect = useCallback(
    async (id: ConnectorId) => {
      setStatus(id, 'connecting')
      try {
        await (connectImpl ?? defaultConnectImpl(connectDelayMs))(id)
        setConnectedIds(prev => {
          if (prev.includes(id)) return prev
          const next = [...prev, id]
          try {
            localStorage.setItem(CONNECTED_KEY, JSON.stringify(next))
          } catch {
            /* ignore */
          }
          return next
        })
        setStatus(id, 'connected')
        return true
      } catch {
        setStatus(id, 'error')
        return false
      }
    },
    [connectDelayMs, connectImpl, setStatus]
  )

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  return {
    services: CONNECTOR_SERVICES,
    connectedIds,
    connectedCount: connectedIds.length,
    statuses,
    dismissed,
    connect,
    dismiss
  }
}
