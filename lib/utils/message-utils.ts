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
            : ''
    const mediaType =
      typeof part.mediaType === 'string' ? part.mediaType : ''
    if (part.type === 'file' && mediaType.startsWith('image/') && url) {
      return url
    }
    if (part.type === 'image' && url) return url
    if (url.startsWith('data:image/')) return url
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
