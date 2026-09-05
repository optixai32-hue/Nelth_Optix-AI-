import { describe, expect, it } from 'vitest'

import { detectVoiceRequest } from '../voice-request'

describe('detectVoiceRequest', () => {
  it('accepts the explicit body flag', () => {
    expect(detectVoiceRequest({ voiceMode: true, message: undefined })).toBe(
      true
    )
  })

  it('detects and strips the in-band marker part', () => {
    const body = {
      message: {
        parts: [
          { type: 'text', text: 'bonjour' },
          { type: 'data-voiceMode', data: { voice: true } }
        ]
      }
    }
    expect(detectVoiceRequest(body)).toBe(true)
    // Marker removed: never persisted, never shown to the model.
    expect(body.message.parts).toEqual([{ type: 'text', text: 'bonjour' }])
  })

  it('rejects normal turns', () => {
    expect(
      detectVoiceRequest({
        message: { parts: [{ type: 'text', text: 'bonjour' }] }
      })
    ).toBe(false)
    expect(detectVoiceRequest({})).toBe(false)
    expect(detectVoiceRequest(null as never)).toBe(false)
  })
})
