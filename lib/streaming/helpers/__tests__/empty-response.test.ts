import { describe, expect, it } from 'vitest'

import { emptyResponseText, shouldInjectEmptyFallback } from '../empty-response'

/**
 * Guards the silent-empty case: the weak model sometimes answers with ONLY
 * fake <tool_call> XML, the sanitizer strips it all, and the turn ends with
 * zero text and zero error — a blank bubble with no Retry. The pipeline
 * must inject an honest fallback line instead.
 */
describe('empty response guard', () => {
  it('injects only on truly silent, non-aborted turns', () => {
    expect(
      shouldInjectEmptyFallback({
        wroteContent: false,
        wroteToolPart: false,
        aborted: false
      })
    ).toBe(true)
    // Text delivered: never touch.
    expect(
      shouldInjectEmptyFallback({
        wroteContent: true,
        wroteToolPart: false,
        aborted: false
      })
    ).toBe(false)
    // Tool/image sections rendered but NO text: the model produced tool
    // output but no conversational answer — this IS an empty response for
    // connector turns (gmail read, drive, etc.) and needs the fallback.
    expect(
      shouldInjectEmptyFallback({
        wroteContent: false,
        wroteToolPart: true,
        aborted: false
      })
    ).toBe(true)
    // Aborted by the user: stay silent.
    expect(
      shouldInjectEmptyFallback({
        wroteContent: false,
        wroteToolPart: false,
        aborted: true
      })
    ).toBe(false)
  })

  it('localizes the fallback', () => {
    expect(emptyResponseText('en')).toContain('try again')
    expect(emptyResponseText('fr')).toContain('réessayer')
    // Default (mg/unknown): French.
    expect(emptyResponseText('mg')).toContain('réessayer')
    expect(emptyResponseText(null)).toContain('réessayer')
  })
})
