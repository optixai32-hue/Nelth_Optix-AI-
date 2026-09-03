import { describe, expect, it } from 'vitest'

import { normalizeSize } from '@/lib/tools/image-generation'

describe('normalizeSize (PixelFlash sizes)', () => {
  it('keeps supported sizes as-is', () => {
    expect(normalizeSize('1024x1024')).toBe('1024x1024')
    expect(normalizeSize('864x1152')).toBe('864x1152')
    expect(normalizeSize('720x1440')).toBe('720x1440')
  })

  it('defaults to square for missing/garbage input', () => {
    expect(normalizeSize(undefined)).toBe('1024x1024')
    expect(normalizeSize('nope')).toBe('1024x1024')
  })

  it('maps legacy ERNIE sizes to the closest PixelFlash aspect', () => {
    // Portrait-ish legacy sizes → portrait PixelFlash size.
    expect(normalizeSize('848x1264')).toBe('864x1152')
    expect(normalizeSize('768x1376')).toBe('768x1344')
    // Landscape legacy sizes → landscape PixelFlash size.
    expect(normalizeSize('1264x848')).toBe('1152x864')
    expect(normalizeSize('1376x768')).toBe('1344x768')
  })
})
