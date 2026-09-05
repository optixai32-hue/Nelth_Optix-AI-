import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'

import type { ConnectorProviderId } from './providers'

/**
 * CSRF protection + PKCE for the OAuth dance, without any database write.
 *
 * `issueState` returns a signed token embedding {provider, userId, verifier,
 * expiry}. It travels as the OAuth `state` param AND is mirrored in an
 * httpOnly cookie; the callback accepts the flow only when both copies match
 * and the signature verifies. Everything is validated again server-side, so a
 * leaked `state` value alone is useless to an attacker.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_STATE_COOKIE = 'nelth_oauth_state'
export const OAUTH_VERIFIER_COOKIE = 'nelth_oauth_verifier'

function stateKey(): Buffer {
  const raw = (process.env.CONNECTORS_ENCRYPTION_KEY ?? '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'CONNECTORS_ENCRYPTION_KEY must be set to 32 random bytes, hex-encoded (64 hex chars). Generate with: openssl rand -hex 32'
    )
  }
  return Buffer.from(raw, 'hex')
}

const b64urlEncode = (buf: Buffer): string =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const b64urlDecode = (text: string): Buffer =>
  Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export interface IssuedOAuthState {
  /** Value for the provider `state` param (also mirrored in a cookie). */
  state: string
  /** PKCE verifier (httpOnly cookie only, never sent to the provider). */
  codeVerifier: string
  /** S256 challenge derived from the verifier. */
  codeChallenge: string
}

export function issueState(
  provider: ConnectorProviderId,
  userId: string
): IssuedOAuthState {
  const nonce = randomBytes(16).toString('hex')
  const verifierBytes = randomBytes(32)
  const codeVerifier = b64urlEncode(verifierBytes)
  const codeChallenge = b64urlEncode(
    createHash('sha256').update(codeVerifier).digest()
  )
  const payload = {
    v: 1,
    provider,
    userId,
    nonce,
    exp: Date.now() + OAUTH_STATE_TTL_MS
  }
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64urlEncode(
    createHmac('sha256', stateKey()).update(body).digest()
  )
  return { state: `${body}.${sig}`, codeVerifier, codeChallenge }
}

export interface VerifiedOAuthState {
  provider: ConnectorProviderId
  userId: string
}

/**
 * Accept the callback only when the `state` query value AND the state cookie
 * are present, identical, correctly signed and unexpired. Returns the embedded
 * provider + userId. Throws otherwise (caller maps to a safe error page).
 */
export function verifyState(
  stateParam: string | null,
  stateCookie: string | null
): VerifiedOAuthState {
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    throw new Error('OAuth state mismatch (possible CSRF — flow aborted)')
  }
  const [body, sig] = stateParam.split('.')
  if (!body || !sig) throw new Error('Malformed OAuth state')
  const expected = b64urlEncode(
    createHmac('sha256', stateKey()).update(body).digest()
  )
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid OAuth state signature')
  }
  let payload: {
    v?: unknown
    provider?: unknown
    userId?: unknown
    exp?: unknown
  }
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as typeof payload
  } catch {
    throw new Error('Malformed OAuth state payload')
  }
  if (
    payload.v !== 1 ||
    (payload.provider !== 'google' &&
      payload.provider !== 'github' &&
      payload.provider !== 'notion') ||
    typeof payload.userId !== 'string' ||
    !payload.userId ||
    typeof payload.exp !== 'number' ||
    payload.exp < Date.now()
  ) {
    throw new Error('Expired or invalid OAuth state')
  }
  return { provider: payload.provider, userId: payload.userId }
}
