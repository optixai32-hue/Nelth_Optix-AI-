import type { Firestore } from 'firebase-admin/firestore'

import { getDb } from '@/lib/firebase/admin'

import * as schema from './schema'
import { generateId } from './schema'

let _db: Firestore | null = null

function instance(): Firestore {
  if (!_db) {
    _db = getDb()
  }
  return _db
}

/**
 * Lazily-initialized Firestore instance. Deferred so that importing this
 * module does not require Firebase credentials at build time.
 */
export const db: Firestore = new Proxy({} as Firestore, {
  get: (_target, prop) => {
    const d = instance()
    const value = (d as any)[prop]
    return typeof value === 'function' ? value.bind(d) : value
  }
})

export function getDbInstance(): Firestore {
  return instance()
}

export { generateId, schema }

// Helper type for the data model (no longer tied to Drizzle).
export type Schema = typeof schema
