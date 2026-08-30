import { ModelMessage, UIMessage } from 'ai'

import { type Message as DBMessage } from '@/lib/db/schema'

// Interface matching the expected DB message input format
interface DatabaseMessageInput {
  role: DBMessage['role']
  parts: any // Using 'any' here as we don't know the exact structure expected by the database
}

/**
 * Converts a single message from AI SDK to a database-compatible message format
 * @param message - Message from AI SDK
 * @returns Database-compatible message object
 */
export function convertMessageForDB(
  message: ModelMessage
): DatabaseMessageInput {
  // Handle case where content might be a string, array, or null
  let parts: any

  if (message.content === null || message.content === undefined) {
    parts = []
  } else if (typeof message.content === 'string') {
    parts = [{ text: message.content }]
  } else if (Array.isArray(message.content)) {
    // For array content (common in assistant messages with tool calls)
    // Extract text parts and join them
    const textParts = message.content
      .filter(part => part.type === 'text')
      .map(part => ({ text: part.text }))

    if (textParts.length > 0) {
      parts = textParts
    } else {
      // If no text parts, use the first part's content or stringify the whole content
      parts = [{ text: JSON.stringify(message.content) }]
    }
  } else {
    // Fall back to JSON string for other content types
    parts = [{ text: JSON.stringify(message.content) }]
  }

  return {
    role: message.role,
    parts: parts
  }
}

/**
 * Converts an array of messages from AI SDK to database-compatible message format
 * @param messages - Array of messages from AI SDK
 * @returns Array of database-compatible message objects
 */
export function convertMessagesForDB(
  messages: ModelMessage[]
): DatabaseMessageInput[] {
  return messages.map(convertMessageForDB)
}

/**
 * Extract the first text content from a message for use as a title
 * @param message - Message from AI SDK
 * @param maxLength - Maximum title length to extract
 * @returns Extracted title string, truncated to maxLength
 */
export function extractTitleFromMessage(
  message: ModelMessage,
  maxLength = 100
): string {
  if (!message.content) return 'New Chat'

  if (typeof message.content === 'string') {
    return message.content.substring(0, maxLength)
  }

  // For array content, try to find text parts
  if (Array.isArray(message.content)) {
    const textPart = message.content.find(part => part.type === 'text')
    if (textPart && 'text' in textPart) {
      return textPart.text.substring(0, maxLength)
    }
  }

  return 'New Chat'
}

/**
 * Extracts text content from UIMessage parts.
 * @param parts Array of message parts to extract text from.
 * @returns Concatenated text content or empty string if no text content is found,
 *          if 'message' or 'message.parts' is undefined, or if 'parts' is empty or contains no text parts.
 */
export function getTextFromParts(parts?: UIMessage['parts']): string {
  return (
    parts
      ?.filter(part => part.type === 'text')
      .map(part => part.text)
      .join(' ') ?? ''
  )
}

/**
 * Returns the URL of an image found in a message's parts, used to force the
 * image-to-image route of the `generateImage` tool so an uploaded/pasted photo
 * is restyled in place rather than triggering a text-to-image generation.
 *
 * Detects:
 *  - `file` parts with `mediaType` starting with `image/` (standard upload)
 *  - AI SDK `image` parts
 *  - inline `data:image/...` URLs (e.g. a pasted screenshot)
 */
export function getImageAttachmentUrl(parts?: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined
  for (const part of parts as any[]) {
    if (!part || typeof part !== 'object') continue
    const url =
      typeof part.url === 'string'
        ? part.url
        : typeof part.data === 'string'
          ? part.data
          : typeof part.content === 'string'
            ? part.content
            : typeof part.file === 'string'
              ? part.file
              : ''
    // Accept any image indicator: an explicit image media type, a data:image
    // URL, or an image file extension on the name/URL. Uploads frequently
    // arrive with mediaType "application/octet-stream" or only a blob/remote
    // URL, so we must not rely solely on mediaType starting with "image/".
    const mediaType =
      typeof part.mediaType === 'string'
        ? part.mediaType
        : typeof part.mimeType === 'string'
          ? part.mimeType
          : typeof part.type === 'string' && part.type.startsWith('image/')
            ? part.type
            : ''
    const name =
      typeof part.filename === 'string'
        ? part.filename
        : typeof part.name === 'string'
          ? part.name
          : ''
    const isImage =
      mediaType.startsWith('image/') ||
      url.startsWith('data:image/') ||
      /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name) ||
      /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(url)
    if (isImage && url) return url
  }
  return undefined
}

// Matches a request that wants to EDIT / RESTYLE / TRANSFORM an existing image
// (often one shown in a previous turn) rather than generate a new one.
const IMAGE_EDIT_REF_RE =
  /\b(restyle|restyl|transform|edit|change|modify|rework|turn|convert|refais|refaire|modifie|chang|transforme|recadre|recadrer|met(s)? (ca|cet|ce|it|that|this) en|en version|cartoon|anime|looney|toon|style)\b/i

/**
 * Find an image to use for image-to-image when the user references an image that
 * lives elsewhere in the conversation (e.g. "restyle this", "turn that into a
 * cartoon") without re-uploading it. Only returns a URL when the latest user
 * message clearly asks to EDIT/TRANSFORM an image — otherwise returns undefined
 * so a plain text-to-image request is never hijacked by a stale image.
 */
export function getReferencedImageUrl(
  messages?: { parts?: unknown[] }[],
  latestUserQuery?: string
): string | undefined {
  if (!Array.isArray(messages) || !latestUserQuery) return undefined
  if (!IMAGE_EDIT_REF_RE.test(latestUserQuery)) return undefined
  // Scan from newest to oldest so we pick the most recent relevant image.
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = getImageAttachmentUrl(messages[i]?.parts)
    if (u) return u
  }
  return undefined
}

/**
 * Merges two UIMessage objects by combining their parts
 * @param primaryMessage The main message (properties from this will be preserved)
 * @param secondaryMessage The message whose parts will be merged into the primary message
 * @returns A new UIMessage with combined parts
 */
export function mergeUIMessages(
  primaryMessage: UIMessage,
  secondaryMessage: UIMessage
): UIMessage {
  return {
    ...primaryMessage,
    parts: [...primaryMessage.parts, ...secondaryMessage.parts]
  }
}

/**
 * Checks if a UIMessage contains tool calls
 * @param message The message to check for tool calls
 * @returns true if the message contains tool calls, false otherwise
 */
export function hasToolCalls(message: UIMessage | null): boolean {
  if (!message || !message.parts) return false

  return message.parts.some(
    part =>
      part.type && (part.type.startsWith('tool-') || part.type === 'tool-call')
  )
}

// Fake XML tool-call blocks the weak non-thinking model emits as text instead of
// native tool calls. These leak into the final answer and are rendered as raw
// <tool_call>…</tool_call> or <tool_calls:id>… markup. Strip them completely so the
// user never sees them.
const FAKE_TOOL_PATTERNS = [
  /<tool_calls?[:\s\w-]*>[\s\S]*?(?:<\/tool_calls?[:\s\w-]*>|<\/invoke[:\s\w-]*>|(?=<tool_calls?[:\s\w-]*>)|$)/gi,
  /<tool_call[:\s\w-]*>[\s\S]*?(?:<\/tool_call[:\s\w-]*>|<\/invoke[:\s\w-]*>|(?=<tool_calls?[:\s\w-]*>)|$)/gi,
  /<invoke[:\s\w-]*>[\s\S]*?(?:<\/invoke[:\s\w-]*>|$)/gi,
  /<function\b[^>]*>[\s\S]*?(?:<\/function>|$)/gi,
  /<tool-search\b[^>]*>[\s\S]*?(?:<\/tool-search>|$)/gi,
  /<\/?(?:tool_calls?|invoke|function|tool-search)[:\s\w-]*\/?>/gi
]

export function stripFakeToolCallXml(text: string): string {
  if (!text) return text
  let result = text
  for (const pattern of FAKE_TOOL_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result
    .replace(/^[ \t]*search">.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripFakeToolCallXmlFromMessage(message: {
  parts?: unknown[]
}): boolean {
  const parts = (message.parts as Array<{ type: string; text?: string }>) ?? []
  let changed = false
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string') {
      const cleaned = stripFakeToolCallXml(p.text)
      if (cleaned !== p.text) {
        p.text = cleaned
        changed = true
      }
    }
  }
  return changed
}

/**
 * Real-time streaming sanitizer to strip fake tool-call pseudo-XML tokens
 * as text chunks arrive from the model during SSE streaming.
 */
export class StreamTextSanitizer {
  private buffer = ''

  /**
   * Processes an incoming text delta. Returns the sanitized text delta
   * safe to immediately stream to the client.
   */
  process(delta: string): string {
    this.buffer += delta

    // If the buffer contains any fake tool call tag markers
    const hasToolTag =
      this.buffer.includes('<tool_call') ||
      this.buffer.includes('<tool_calls') ||
      this.buffer.includes('<invoke') ||
      this.buffer.includes('<function') ||
      this.buffer.includes('<tool-search')

    if (hasToolTag) {
      // If the fake tool call block has closed
      const hasClosed =
        this.buffer.includes('</invoke') ||
        this.buffer.includes('</tool_call') ||
        this.buffer.includes('</function') ||
        this.buffer.includes('</tool-search>')

      if (hasClosed) {
        const cleaned = stripFakeToolCallXml(this.buffer)
        this.buffer = ''
        return cleaned
      }

      // If it hasn't closed yet, but buffer has grown large (> 250 chars) or has double newline,
      // it might be an unclosed fake tag followed by real text
      if (this.buffer.length > 250 || this.buffer.includes('\n\n')) {
        const cleaned = stripFakeToolCallXml(this.buffer)
        this.buffer = ''
        return cleaned
      }

      // Still accumulating the fake tool call XML block — hold in buffer
      return ''
    }

    // Check if buffer ends with a partial tag starting with '<'
    const lastOpenBracket = this.buffer.lastIndexOf('<')
    if (lastOpenBracket !== -1 && !this.buffer.includes('>', lastOpenBracket)) {
      const potentialTag = this.buffer.slice(lastOpenBracket)
      if (
        '<tool_call'.startsWith(potentialTag) ||
        '<tool_calls'.startsWith(potentialTag) ||
        '</invoke'.startsWith(potentialTag) ||
        '<invoke'.startsWith(potentialTag) ||
        '<function'.startsWith(potentialTag) ||
        '<tool-search'.startsWith(potentialTag)
      ) {
        // Emit everything before the partial tag, hold partial tag in buffer
        const safe = this.buffer.slice(0, lastOpenBracket)
        this.buffer = potentialTag
        return safe
      }
    }

    const output = this.buffer
    this.buffer = ''
    return output
  }

  /**
   * Flushes any remaining clean text at stream end.
   */
  flush(): string {
    const remaining = stripFakeToolCallXml(this.buffer)
    this.buffer = ''
    return remaining
  }
}

// Detect pure greetings / short chat messages that do NOT need web search.
// These are conversational turns where the model should answer immediately
// without any tool. Anything longer or more specific (even if it fails the
// strict intent regexes) should still get preloaded search for the weak
// model so it doesn't hallucinate [n] citations.
const PURE_GREETING_RE =
  /^\s*(bonjour|hello|hi|hey|salut|coucou|yo|ça\s+va|ca\s+va|comment\s+(ça|ca)\s+va|what'?s\s+up|how\s+are\s+you|comment\s+allez[- ]vous|merci|thanks|thx|ok|okay|oui|yes|no|non|d'?accord|noted|super|cool|great|bien|bienvenue|welcome|bye|au\s+revoir|bonne\s+(journée|nuit)|good\s+(morning|evening|night|afternoon))\s*[!?.?\s]*$/i

export function isPureGreeting(query: string): boolean {
  if (!query) return false
  const trimmed = query.trim()
  // Very short messages (< 25 chars) that match a greeting pattern
  if (trimmed.length > 40) return false
  return PURE_GREETING_RE.test(trimmed)
}
