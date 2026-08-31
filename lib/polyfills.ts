/**
 * Universal runtime polyfills for older mobile browsers and older iOS Safari versions:
 * - iOS 12, 13, 14, 15.0-15.6, 16.0 (Safari lacks requestSubmit, ResizeObserver, Array.at, crypto.getRandomValues, etc.)
 * - Older Android WebViews and Chrome versions
 * 
 * Loaded at the very top of the app lifecycle to ensure seamless execution on any device.
 */

if (typeof window !== 'undefined') {
  // 0. crypto & crypto.getRandomValues (Mandatory for @paralleldrive/cuid2 and React keys)
  if (!window.crypto) {
    ;(window as any).crypto = {}
  }
  if (!window.crypto.getRandomValues) {
    window.crypto.getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
      if (!array) return array
      const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let i = 0; i < uint8.length; i++) {
        uint8[i] = Math.floor(Math.random() * 256)
      }
      return array
    }
  }

  // 1. HTMLFormElement.prototype.requestSubmit (Safari < 16 lacks requestSubmit!)
  if (typeof HTMLFormElement !== 'undefined' && !HTMLFormElement.prototype.requestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement | null) {
      if (submitter) {
        if (typeof submitter.click === 'function') {
          submitter.click()
          return
        }
      }
      const submitEvent = new CustomEvent('submit', {
        bubbles: true,
        cancelable: true
      })
      if (this.dispatchEvent(submitEvent)) {
        this.submit()
      }
    }
  }

  // 2. queueMicrotask
  if (!window.queueMicrotask) {
    window.queueMicrotask = function (cb: () => void) {
      Promise.resolve()
        .then(cb)
        .catch(err => {
          setTimeout(() => {
            throw err
          }, 0)
        })
    }
  }

  // 3. Array.prototype.at
  if (!Array.prototype.at) {
    Array.prototype.at = function (n: number) {
      const len = this.length
      const k = n >= 0 ? n : len + n
      if (k < 0 || k >= len) return undefined
      return this[k]
    }
  }

  // 4. String.prototype.at
  if (!String.prototype.at) {
    String.prototype.at = function (n: number) {
      const len = this.length
      const k = n >= 0 ? n : len + n
      if (k < 0 || k >= len) return ''
      return this.charAt(k)
    }
  }

  // 5. Array.prototype.findLast
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

  // 6. Array.prototype.findLastIndex
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

  // 7. Object.hasOwn
  if (!Object.hasOwn) {
    Object.hasOwn = function (object: any, property: PropertyKey): boolean {
      if (object == null) {
        throw new TypeError('Cannot convert undefined or null to object')
      }
      return Object.prototype.hasOwnProperty.call(object, property)
    }
  }

  // 8. crypto.randomUUID fallback
  if (!window.crypto.randomUUID) {
    window.crypto.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
      if (typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16)
        window.crypto.getRandomValues(bytes)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as any
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      }) as any
    }
  }

  // 9. structuredClone fallback
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

  // 10. ResizeObserver fallback
  if (typeof window.ResizeObserver !== 'function') {
    ;(window as any).ResizeObserver = class {
      private callback: Function
      constructor(callback: Function) {
        this.callback = callback
      }
      observe(target: Element) {
        // Trigger once safely
        setTimeout(() => {
          try {
            const rect = target.getBoundingClientRect()
            this.callback([
              {
                target,
                contentRect: rect
              }
            ])
          } catch {}
        }, 0)
      }
      unobserve() {}
      disconnect() {}
    }
  }

  // 11. requestIdleCallback fallback
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

  // 12. Safe localStorage / sessionStorage in Safari private mode
  try {
    const testKey = '__test_storage__'
    window.localStorage.setItem(testKey, testKey)
    window.localStorage.removeItem(testKey)
  } catch {
    const memoryStorage: Record<string, string> = {}
    const mockStorage = {
      getItem: (key: string) => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key: string, value: string) => {
        memoryStorage[key] = String(value)
      },
      removeItem: (key: string) => {
        delete memoryStorage[key]
      },
      clear: () => {
        Object.keys(memoryStorage).forEach(k => delete memoryStorage[k])
      },
      key: (i: number) => Object.keys(memoryStorage)[i] ?? null,
      get length() {
        return Object.keys(memoryStorage).length
      }
    }
    try {
      Object.defineProperty(window, 'localStorage', { value: mockStorage })
    } catch {}
  }
}

export {}
