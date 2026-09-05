import type { ConnectorProviderId } from './providers'
import { getValidAccessToken } from './vault'

/**
 * Authenticated HTTP layer for connector provider APIs.
 *
 * Every call mints a fresh (or freshly refreshed) access token from the
 * encrypted server vault — token material never leaves the server.
 */

const FETCH_TIMEOUT_MS = 15_000

/** Thrown when the provider rejects our token: user must reconnect. */
export class ConnectorAuthError extends Error {
  provider: ConnectorProviderId
  constructor(provider: ConnectorProviderId) {
    super(`${provider} authorization expired or revoked`)
    this.name = 'ConnectorAuthError'
    this.provider = provider
  }
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403
}

/**
 * fetch() with the user's Bearer token. Throws ConnectorAuthError when the
 * provider rejects the credentials (expired / revoked grant).
 */
export async function authedFetch(
  userId: string,
  provider: ConnectorProviderId,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken(userId, provider)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (isAuthStatus(res.status)) {
    throw new ConnectorAuthError(provider)
  }
  return res
}

async function readJson(res: Response, url: string): Promise<any> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Connector API error ${res.status} for ${url}: ${body.slice(0, 200)}`
    )
  }
  try {
    return await res.json()
  } catch {
    throw new Error(`Connector API returned non-JSON for ${url}`)
  }
}

export async function connectorGetJson(
  userId: string,
  provider: ConnectorProviderId,
  url: string,
  init: RequestInit = {}
): Promise<any> {
  const res = await authedFetch(userId, provider, url, {
    ...init,
    method: 'GET'
  })
  return readJson(res, url)
}

export async function connectorPostJson(
  userId: string,
  provider: ConnectorProviderId,
  url: string,
  body: unknown,
  init: RequestInit = {}
): Promise<any> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const res = await authedFetch(userId, provider, url, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  return readJson(res, url)
}

/** Hard cap for text injected into the model context. */
export function truncateText(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n…[truncated, ${text.length} chars total]`
}
