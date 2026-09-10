import { after } from 'next/server'

import { trackAdaptiveLimitEvent } from '@/lib/analytics'
import {
  incrementFirestoreRateLimit,
  isEnforced
} from '@/lib/rate-limit/firestore'
import { perfLog } from '@/lib/utils/perf-logging'

const DEFAULT_ADAPTIVE_DAILY_LIMIT = 30

function getAdaptiveDailyLimit(): number {
  const raw = process.env.ADAPTIVE_CHAT_DAILY_LIMIT
  const parsed = raw ? Number(raw) : DEFAULT_ADAPTIVE_DAILY_LIMIT
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ADAPTIVE_DAILY_LIMIT
  }
  return Math.floor(parsed)
}

interface AdaptiveLimitCheckResult {
  allowed: boolean
  /** Current count after this attempt is included */
  used: number
  remaining: number
  resetAt: number
  limit: number
  /** True when the check ran against Firestore (i.e. enforced) */
  enforced: boolean
}

async function checkAdaptiveLimit(
  userId: string
): Promise<AdaptiveLimitCheckResult> {
  const limit = getAdaptiveDailyLimit()

  if (!isEnforced()) {
    return {
      allowed: true,
      used: 0,
      remaining: Infinity,
      resetAt: 0,
      limit,
      enforced: false
    }
  }

  const dateKey = new Date().toISOString().split('T')[0]
  const key = `rl:adaptive:${userId}:${dateKey}`

  try {
    return await incrementFirestoreRateLimit(key, limit)
  } catch (err) {
    console.error('[AdaptiveLimit] Counter failed, failing open:', err)
    return {
      allowed: true,
      used: 0,
      remaining: limit,
      resetAt: 0,
      limit,
      enforced: false
    }
  }
}

/**
 * Enforce per-user daily limit on adaptive search mode.
 * Returns a 429 Response if the limit is reached, null otherwise.
 */
export async function checkAndEnforceAdaptiveLimit(
  userId: string
): Promise<Response | null> {
  const result = await checkAdaptiveLimit(userId)

  // Only emit analytics for real (Firestore-backed) checks. Local dev / cloud
  // without Firebase Admin returns enforced=false and we skip tracking to avoid
  // polluting the dashboard with no-op events.
  //
  // Hand the capture to `after` rather than letting it float: the blocked
  // path returns a 429 immediately, so an un-awaited PostHog flush can be
  // cut short when the serverless runtime freezes. Allowed requests go on
  // to a long-lived stream and would survive, which would bias the block
  // rate downward exactly where it matters.
  if (result.enforced) {
    after(
      trackAdaptiveLimitEvent({
        outcome: result.allowed ? 'allowed' : 'blocked',
        userId,
        used: result.used,
        limit: result.limit
      })
    )
  }

  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error:
          'Daily limit for Adaptive mode reached. Please try again tomorrow, or continue in Quick mode.',
        remaining: 0,
        resetAt: result.resetAt,
        limit: result.limit,
        mode: 'adaptive'
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.resetAt)
        }
      }
    )
  }

  perfLog(`Adaptive usage: ${result.used}/${result.limit}`)

  return null
}
