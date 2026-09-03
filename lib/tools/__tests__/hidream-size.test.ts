import { describe, expect, it } from 'vitest'

import { normalizeSize, sizeToAspectRatio } from '@/lib/tools/image-generation'

describe('normalizeSize (HiDream request sizes)', () => {
  it('keeps supported sizes as-is', () => {
    expect(normalizeSize('1024x1024')).toBe('1024x1024')
    expect(normalizeSize('864x1152')).toBe('864x1152')
    expect(normalizeSize('720x1440')).toBe('720x1440')
  })

  it('defaults to square for missing/garbage input', () => {
    expect(normalizeSize(undefined)).toBe('1024x1024')
    expect(normalizeSize('nope')).toBe('1024x1024')
  })
})

describe('sizeToAspectRatio (HiDream aspect ratios)', () => {
  it('maps exact aspects', () => {
    expect(sizeToAspectRatio('1024x1024')).toBe('1:1')
    expect(sizeToAspectRatio('864x1152')).toBe('3:4')
    expect(sizeToAspectRatio('1152x864')).toBe('4:3')
  })

  it('maps near aspects to the closest supported ratio', () => {
    // 768x1344 (4:7) and 720x1440 (1:2) are closest to 9:16.
    expect(sizeToAspectRatio('768x1344')).toBe('9:16')
    expect(sizeToAspectRatio('720x1440')).toBe('9:16')
    // 1344x768 (~16:9) and 1440x720 (2:1) are closest to 16:9.
    expect(sizeToAspectRatio('1344x768')).toBe('16:9')
    expect(sizeToAspectRatio('1440x720')).toBe('16:9')
  })

  it('falls back to square for garbage input', () => {
    expect(sizeToAspectRatio('nope')).toBe('1:1')
  })
})
