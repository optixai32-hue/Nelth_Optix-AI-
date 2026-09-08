'use client'

import { type Analytics, getAnalytics, isSupported } from 'firebase/analytics'
import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import { type Auth, getAuth } from 'firebase/auth'

import { getFirebaseClientConfig } from './config'

let app: FirebaseApp | null = null

export function getFirebaseApp(): FirebaseApp {
  if (app) return app
  if (getApps().length > 0) {
    app = getApp()
    return app
  }
  app = initializeApp(getFirebaseClientConfig() as Record<string, string>)
  return app
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

let analyticsPromise: Promise<Analytics | null> | null = null

/**
 * Lazily initialize Firebase Analytics in the browser. Returns null when
 * Analytics is unsupported (e.g. SSR, or no measurementId configured).
 */
export function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (analyticsPromise) return analyticsPromise
  analyticsPromise = (async () => {
    if (typeof window === 'undefined') return null
    if (!(await isSupported())) return null
    const config = getFirebaseClientConfig()
    if (!config.measurementId) return null
    return getAnalytics(getFirebaseApp())
  })()
  return analyticsPromise
}

/**
 * Exchange a Firebase ID token for an HTTP-only session cookie (server-side
 * verification via Firebase Admin). Used right after sign-in / sign-up.
 */
export async function establishSession(idToken: string): Promise<void> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  })
  if (!res.ok) {
    throw new Error('Failed to establish session')
  }
}

export async function clearSession(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE' })
}
