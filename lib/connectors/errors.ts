import type { ConnectorProviderId } from './providers'

/** Thrown when the provider rejects our credentials: user must reconnect. */
export class ConnectorAuthError extends Error {
  provider: ConnectorProviderId
  constructor(provider: ConnectorProviderId) {
    super(`${provider} authorization expired or revoked`)
    this.name = 'ConnectorAuthError'
    this.provider = provider
  }
}

/** True for refresh/exchange failures that mean "grant is dead, reconnect". */
export function isGrantDeadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /invalid_grant|invalid_token|expired_token|unauthorized|unauthenticated|HTTP 401/i.test(
    msg
  )
}
