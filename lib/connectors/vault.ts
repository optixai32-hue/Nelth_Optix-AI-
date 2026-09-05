import { getFirestore } from 'firebase-admin/firestore'

import { getAdminApp } from '@/lib/firebase/admin'

import { decryptSecret, encryptSecret } from './crypto'
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
    .set(toStored(provider, tokens), { merge: true })
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
 * Throws when no connection exists or the refresh fails (caller surfaces a
 * "reconnect" state — never the raw error with token material).
 */
export async function getValidAccessToken(
  userId: string,
  provider: ConnectorProviderId
): Promise<string> {
  const conn = await getConnection(userId, provider)
  if (!conn?.accessTokenSealed) {
    throw new Error(`No ${provider} connection for this user`)
  }
  const fresh =
    !conn.expiresAt || conn.expiresAt - Date.now() > REFRESH_SKEW_MS
  if (fresh) return decryptSecret(conn.accessTokenSealed)
  if (!conn.refreshTokenSealed) {
    // Permanent token past its (unknown) lifetime — return it once and let
    // the API call itself decide; do not delete on suspicion.
    return decryptSecret(conn.accessTokenSealed)
  }
  const refreshed = await refreshAccessToken({
    provider,
    refreshToken: decryptSecret(conn.refreshTokenSealed)
  })
  await providersCollection(userId)
    .doc(provider)
    .set(
      {
        accessTokenSealed: encryptSecret(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
        updatedAt: Date.now()
      },
      { merge: true }
    )
  return refreshed.accessToken
}
