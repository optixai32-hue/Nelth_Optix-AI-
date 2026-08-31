/**
 * Universal runtime polyfills for older mobile browsers and older iOS Safari versions:
 * - iOS 12, 13, 14, 15.0-15.3 (Safari < 15.4 lacks Array.at, Object.hasOwn, crypto.randomUUID, etc.)
 * - Older Android WebViews and Chrome versions
 * 
 * Loaded at the very top of the app lifecycle to ensure seamless execution on any device.
 */

if (typeof window !== 'undefined') {
  // 1. Array.prototype.at
  if (!Array.prototype.at) {
    Array.prototype.at = function (n: number) {
      const len = this.length
      const k = n >= 0 ? n : len + n
      if (k < 0 || k >= len) return undefined
      return this[k]
    }
  }

  // 2. String.prototype.at
  if (!String.prototype.at) {
    String.prototype.at = function (n: number) {
      const len = this.length
      const k = n >= 0 ? n : len + n
      if (k < 0 || k >= len) return ''
      return this.charAt(k)
    }
  }

  // 3. Array.prototype.findLast
  if (!Array.prototype.findLast) {
    Array.prototype.findLast = function (predicate: (value: any, index: number, obj: any[]) => boolean, thisArg?: any) {
      for (let i = this.length - 1; i >= 0; i--) {
        if (predicate.call(thisArg, this[i], i, this)) {
          return this[i]
        }
      }
      return undefined
    }
  }

  // 4. Array.prototype.findLastIndex
  if (!Array.prototype.findLastIndex) {
    Array.prototype.findLastIndex = function (predicate: (value: any, index: number, obj: any[]) => boolean, thisArg?: any) {
      for (let i = this.length - 1; i >= 0; i--) {
        if (predicate.call(thisArg, this[i], i, this)) {
          return i
        }
      }
      return -1
    }
  }

  // 5. Object.hasOwn
  if (!Object.hasOwn) {
    Object.hasOwn = function (object: any, property: PropertyKey): boolean {
      if (object == null) {
        throw new TypeError('Cannot convert undefined or null to object')
      }
      return Object.prototype.hasOwnProperty.call(object, property)
    }
  }

  // 6. crypto.randomUUID fallback
  if (typeof window.crypto !== 'undefined' && !window.crypto.randomUUID) {
    window.crypto.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
      if (typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16)
        window.crypto.getRandomValues(bytes)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as any
      }
      // Math.random fallback for very old engines
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      }) as any
    }
  }

  // 7. structuredClone fallback
  if (typeof window.structuredClone !== 'function') {
    window.structuredClone = function (obj: any) {
      if (obj === undefined) return undefined
      try {
        return JSON.parse(JSON.stringify(obj))
      } catch {
        return obj
      }
    }
  }

  // 8. requestIdleCallback fallback
  if (typeof (window as any).requestIdleCallback !== 'function') {
    ;(window as any).requestIdleCallback = function (cb: Function) {
      const start = Date.now()
      return setTimeout(() => {
        cb({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
        })
      }, 1)
    }
    ;(window as any).cancelIdleCallback = function (id: number) {
      clearTimeout(id)
    }
  }
}

export {}
