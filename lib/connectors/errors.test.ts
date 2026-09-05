import { describe, expect, it } from 'vitest'

import { ConnectorAuthError, isGrantDeadError } from './errors'

describe('connector errors', () => {
  it('ConnectorAuthError carries the provider', () => {
    const err = new ConnectorAuthError('github')
    expect(err).toBeInstanceOf(Error)
    expect(err.provider).toBe('github')
    expect(err.name).toBe('ConnectorAuthError')
  })

  it('detects dead-grant failures', () => {
    expect(isGrantDeadError(new Error('OAuth failed: invalid_grant'))).toBe(
      true
    )
    expect(isGrantDeadError(new Error('HTTP 401'))).toBe(true)
    expect(isGrantDeadError(new Error('unauthorized'))).toBe(true)
    expect(isGrantDeadError(new ConnectorAuthError('google'))).toBe(false)
  })

  it('does not mistake rate limits for dead grants', () => {
    expect(isGrantDeadError(new Error('Connector API error 403'))).toBe(false)
    expect(isGrantDeadError(new Error('rateLimitExceeded'))).toBe(false)
    expect(isGrantDeadError(new Error('boom'))).toBe(false)
  })
})
