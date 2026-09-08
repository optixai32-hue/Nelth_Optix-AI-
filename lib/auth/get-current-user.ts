import { cookies } from 'next/headers'

import { getAuth } from '@/lib/firebase/admin'
import { hasFirebaseConfig, SESSION_COOKIE } from '@/lib/firebase/config'
import type { AppUser } from '@/lib/firebase/user'
import { perfLog } from '@/lib/utils/perf-logging'
import { incrementAuthCallCount } from '@/lib/utils/perf-tracking'

export interface CurrentUser {
  uid: string
  email?: string
  displayName?: string
  photoURL?: string
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!hasFirebaseConfig()) {
    return null
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) {
    return null
  }

  try {
    const decoded = await getAuth().verifySessionCookie(token, true)
    return {
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
      photoURL: decoded.picture
    }
  } catch {
    return null
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const count = incrementAuthCallCount()
  perfLog(`getCurrentUserId called - count: ${count}`)

  // Skip authentication mode (for personal Docker/local deployments)
  if (process.env.ENABLE_AUTH === 'false') {
    // Guard: Prevent disabling auth in Morphic Cloud deployments
    if (process.env.MORPHIC_CLOUD_DEPLOYMENT === 'true') {
      throw new Error(
        'ENABLE_AUTH=false is not allowed in MORPHIC_CLOUD_DEPLOYMENT'
      )
    }

    // Always warn when authentication is disabled (except in tests)
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '⚠️  Authentication disabled. Running in anonymous mode.\n' +
          '   All users share the same user ID. For personal use only.'
      )
    }

    return process.env.ANONYMOUS_USER_ID || 'anonymous-user'
  }

  const user = await getCurrentUser()
  return user?.uid ?? null
}

export function toAppUserFromServer(user: CurrentUser): AppUser {
  return {
    id: user.uid,
    email: user.email ?? null,
    name: user.displayName ?? null,
    image: user.photoURL ?? null
  }
}
