'use client'

import { useSyncExternalStore } from 'react'

/**
 * Custom hook to track media query matches.
 * @param query - The media query string (e.g., '(max-width: 767px)').
 * @returns boolean - True if the media query matches, false otherwise.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onStoreChange => {
      if (typeof window === 'undefined') {
        return () => {}
      }

      const mql = window.matchMedia(query)
      const handler = () => onStoreChange()
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handler)
      } else if (typeof (mql as any).addListener === 'function') {
        ;(mql as any).addListener(handler)
      }

      return () => {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', handler)
        } else if (typeof (mql as any).removeListener === 'function') {
          ;(mql as any).removeListener(handler)
        }
      }
    },
    () => {
      if (typeof window === 'undefined') {
        return false
      }

      return window.matchMedia(query).matches
    },
    () => false
  )
}
