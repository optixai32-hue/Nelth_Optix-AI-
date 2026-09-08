import type { FilePart, TextPart } from '@ai-sdk/provider-utils'
import { randomUUID } from 'crypto'

/**
 * Maps Morphic's user-authored data parts into model input for
 * `convertToModelMessages({ convertDataPart })`. Returning `undefined` drops
 * the part from the model message.
 *
 * Pasted content is wrapped in a nonce-delimited block so the content itself
 * can never spoof the boundary — this replaces the old in-band `<user-content>`
 * marker and removes its prompt-injection / boundary-collision risk.
 */
export function convertDataPart(part: {
  type: string
  data?: unknown
}): TextPart | FilePart | undefined {
  if (part.type === 'data-pastedContent') {
    const data = part.data as { text?: unknown } | undefined
    const text = typeof data?.text === 'string' ? data.text : ''
    if (!text) return undefined
    const nonce = randomUUID().slice(0, 8)
    return {
      type: 'text',
      text: `[user-pasted-content ${nonce}]\n${text}\n[/user-pasted-content ${nonce}]`
    }
  }

  if (part.type === 'data-quotedContext') {
    const data = part.data as { text?: unknown } | undefined
    const text = typeof data?.text === 'string' ? data.text : ''
    if (!text) return undefined
    const nonce = randomUUID().slice(0, 8)
    return {
      type: 'text',
      text: `[quoted-context ${nonce}]\n${text}\n[/quoted-context ${nonce}]`
    }
  }

  if (part.type === 'data-noteContext') {
    const data = part.data as { title?: unknown; text?: unknown } | undefined
    const text = typeof data?.text === 'string' ? data.text : ''
    const title = typeof data?.title === 'string' ? data.title.trim() : ''
    if (!text) return undefined
    const nonce = randomUUID().slice(0, 8)
    const body = title ? `Title: ${title}\n\n${text}` : text
    return {
      type: 'text',
      text: `[note-context ${nonce}]\n${body}\n[/note-context ${nonce}]`
    }
  }

  if (part.type === 'data-sourceUrl') {
    const data = part.data as { url?: unknown } | undefined
    const url = typeof data?.url === 'string' ? data.url : ''
    return url ? { type: 'text', text: url } : undefined
  }

  // Uploaded document attachment. Emitted as a text description (filename +
  // accessible URL) so the model can hand the URL to the `document` tool. We must
  // NOT forward a raw `file` content part: some OpenAI-compatible providers
  // (e.g. NVIDIA) reject non-standard content-part types and return a 400
  // ("data did not match any variant of ... UserMessageContent").
  if (part.type === 'data-file') {
    const data = part.data as
      | {
          url?: unknown
          filename?: unknown
          mediaType?: unknown
          key?: unknown
        }
      | undefined
    const url = typeof data?.url === 'string' ? data.url : ''
    const name = typeof data?.filename === 'string' ? data.filename : 'file'
    const mediaType =
      typeof data?.mediaType === 'string'
        ? data.mediaType
        : 'application/octet-stream'
    const nonce = randomUUID().slice(0, 8)
    // Images are edited in place via the generateImage tool (the runtime
    // automatically attaches the uploaded photo), so steer the model there
    // instead of the document tool.
    if (mediaType.startsWith('image/')) {
      return {
        type: 'text',
        text: `[attached image ${nonce}]\nFile: ${name}\nType: ${mediaType}\nURL: ${url}\nThis is an image. To restyle, edit, or transform it (preserving the subject), call the generateImage tool. The image is already attached by the runtime, so you can omit its \`image\` argument — just describe the desired style in \`prompt\`.[/attached image ${nonce}]`
      }
    }
    return {
      type: 'text',
      text: `[attached file ${nonce}]\nFile: ${name}\nType: ${mediaType}\nURL: ${url}\nUse the document tool with this URL to read or modify it.[/attached file ${nonce}]`
    }
  }

  return undefined
}

/**
 * Rewrite uploaded `file` UIMessage parts into `data-file` parts so they are
 * routed through `convertDataPart` (above) into plain text instead of leaking a
 * `file` content part that some model providers reject. Operates on a copy — the
 * original UIMessage parts (used for skill routing via extractAttachmentFormats)
 * are left untouched.
 */
export function mapFilePartsToDataParts(messages: any[]): any[] {
  return (messages ?? []).map(m => {
    if (m?.role !== 'user' || !Array.isArray(m.parts)) return m
    let changed = false
    const parts = m.parts.map((p: any) => {
      if (p && p.type === 'file') {
        changed = true
        return {
          type: 'data-file',
          data: {
            url: p.url ?? '',
            filename: p.filename ?? 'file',
            mediaType: p.mediaType ?? 'application/octet-stream',
            key: p.key
          }
        }
      }
      return p
    })
    return changed ? { ...m, parts } : m
  })
}
