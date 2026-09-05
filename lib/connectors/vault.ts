import { getFirestore } from 'firebase-admin/firestore'

import { getAdminApp } from '@/lib/firebase/admin'

import { decryptSecret, encryptSecret } from './crypto'
import { ConnectorAuthError, isGrantDeadError } from './errors'
import {
  type ConnectorProviderId,
  refreshAccessToken,
  type TokenResult
} from './providers'

/**
 * Encrypted per-user OAuth token vault (Firestore).
 *
 * Collection layout: `connector_tokens/{userId}/providers/{providerId}`.
 * Only the refresh token is stored, AES-256-GCM sealed. Access tokens are
 * short-lived and re-minted on demand via `getValidAccessToken` (refresh
 * flow with a 60s skew), so a database read never leaks a usable credential.
 */

export interface StoredConnection {
  provider: ConnectorProviderId
  refreshTokenSealed: string | null
  accessTokenSealed: string | null
  expiresAt: number | null
  scope?: string
  providerAccountId?: string
  providerAccountName?: string
  /** Set when the grant died (revoked/expired): UI shows Reconnect. */
  authFailedAt?: number | null
  updatedAt: number
}

const REFRESH_SKEW_MS = 60 * 1000

function providersCollection(userId: string) {
  return getFirestore(getAdminApp())
    .collection('connector_tokens')
    .doc(userId)
    .collection('providers')
}

function toStored(
  provider: ConnectorProviderId,
  tokens: TokenResult
): StoredConnection {
  return {
    provider,
    refreshTokenSealed: tokens.refreshToken
      ? encryptSecret(tokens.refreshToken)
      : null,
    // Cached access token (sealed too). Refreshed transparently on read.
    accessTokenSealed: encryptSecret(tokens.accessToken),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    providerAccountId: tokens.providerAccountId,
    providerAccountName: tokens.providerAccountName,
    updatedAt: Date.now()
  }
}

export async function saveConnection(
  userId: string,
  provider: ConnectorProviderId,
  tokens: TokenResult
): Promise<void> {
  if (!userId) throw new Error('saveConnection requires a userId')
  await providersCollection(userId)
    .doc(provider)
    .set({ ...toStored(provider, tokens), authFailedAt: null }, { merge: true })
}

/** Records a dead grant so the UI can offer Reconnect instead of green. */
export async function markConnectorAuthFailure(
  userId: string,
  provider: ConnectorProviderId
): Promise<void> {
  if (!userId) return
  await providersCollection(userId)
    .doc(provider)
    .set({ authFailedAt: Date.now(), updatedAt: Date.now() }, { merge: true })
    .catch(() => {})
}

/** True when the stored grant is known-dead (needsReconnect UI state). */
export async function connectionNeedsReconnect(
  userId: string,
  provider: ConnectorProviderId
): Promise<boolean> {
  const conn = await getConnection(userId, provider).catch(() => null)
  return Boolean(conn?.authFailedAt)
}

export async function getConnection(
  userId: string,
  provider: ConnectorProviderId
): Promise<StoredConnection | null> {
  if (!userId) return null
  const snap = await providersCollection(userId).doc(provider).get()
  if (!snap.exists) return null
  const data = snap.data() as Partial<StoredConnection> | undefined
  if (!data || typeof data.refreshTokenSealed === 'undefined') return null
  return data as StoredConnection
}

export async function deleteConnection(
  userId: string,
  provider: ConnectorProviderId
): Promise<void> {
  if (!userId) return
  await providersCollection(userId).doc(provider).delete().catch(() => {})
}

/** True when the user has stored (refreshable or permanent) credentials. */
export async function hasConnection(
  userId: string,
  provider: ConnectorProviderId
): Promise<boolean> {
  const conn = await getConnection(userId, provider)
  if (!conn) return false
  // Permanent tokens (GitHub classic, Notion) have no refresh token.
  if (!conn.refreshTokenSealed) return !!conn.accessTokenSealed
  return true
}

/**
 * Returns a usable access token, refreshing it first when expired.
 * Throws ConnectorAuthError when no connection exists or the grant died
 * (caller surfaces a "reconnect" state — never token material).
 */
export async function getValidAccessToken(
  userId: string,
  provider: ConnectorProviderId
): Promise<string> {
  const conn = await getConnection(userId, provider)
  if (!conn?.accessTokenSealed) {
    throw new ConnectorAuthError(provider)
  }
  const fresh =
    !conn.expiresAt || conn.expiresAt - Date.now() > REFRESH_SKEW_MS
  if (fresh) {
    if (conn.authFailedAt) {
      // A previous call proved the grant dead — don't serve the token.
      throw new ConnectorAuthError(provider)
    }
    return decryptSecret(conn.accessTokenSealed)
  }
  if (!conn.refreshTokenSealed) {
    // Permanent token past its (unknown) lifetime — return it once and let
    // the API call itself decide; do not delete on suspicion.
    return decryptSecret(conn.accessTokenSealed)
  }
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    refreshed = await refreshAccessToken({
      provider,
      refreshToken: decryptSecret(conn.refreshTokenSealed)
    })
  } catch (error) {
    if (isGrantDeadError(error)) {
      await markConnectorAuthFailure(userId, provider)
      throw new ConnectorAuthError(provider)
    }
    throw error
  }
  await providersCollection(userId)
    .doc(provider)
    .set(
      {
        accessTokenSealed: encryptSecret(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
        // Persist a rotated refresh token (GitHub Apps rotate on refresh);
        // without this the next refresh uses a dead token.
        ...(refreshed.refreshToken
          ? { refreshTokenSealed: encryptSecret(refreshed.refreshToken) }
          : {}),
        authFailedAt: null,
        updatedAt: Date.now()
      },
      { merge: true }
    )
  return refreshed.accessToken
}
