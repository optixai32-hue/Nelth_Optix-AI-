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
  /<tool_calls?\b[^>]*>[\s\S]*?(?:<\/tool_calls?\b[^>]*>|<\/invoke\b[^>]*>|(?=<tool_calls?\b)|$)/gi,
  /<tool_call\b[^>]*>[\s\S]*?(?:<\/tool_call\b[^>]*>|<\/invoke\b[^>]*>|(?=<tool_calls?\b)|$)/gi,
  /<invoke\b[^>]*>[\s\S]*?(?:<\/invoke\b[^>]*>|$)/gi,
  /<function\b[^>]*>[\s\S]*?(?:<\/function>|$)/gi,
  /<tool-search\b[^>]*>[\s\S]*?(?:<\/tool-search>|$)/gi,
  /<\/?(?:tool_calls?|tool_call|invoke|function|tool-search)\b[^>]*\/?>/gi,
  /<\/?tool_call(?:s|:[a-zA-Z0-9_-]+)?[^>]*>/gi
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
 * Tests the very START of a response: could this open with a greeting reset?
 * (Word boundaries matter: "hi" must not match "histoire".)
 */
const INTRO_START_RE =
  /^\s*(?:(?:bonjour|bonsoir|salut|coucou|hello|hey|hi)\b|👋|je suis nelth|ravi|content|enchanté)/i

/**
 * Detects a "greeting reset" intro paragraph: the weak model re-greets and/or
 * re-introduces itself at the start of EVERY answer ("Salut ! 👋 Ravi de vous
 * revoir. Je suis Nelth-IA, ...") even mid-conversation, despite prompt rules.
 * Returns true when the whole paragraph is intro fluff (greeting-led or
 * self-intro-led) rather than real answer content.
 */
const INTRO_PARAGRAPH_RE =
  /^\s*(?:(?:bonjour|bonsoir|salut|coucou|hello|hey|hi)\b|👋|je suis nelth-ia|je suis nelth\b|ravi(?:e)? de vous|content(?:e)? de vous|enchanté(?:e)?)/i

/**
 * Strips leading intro-fluff paragraphs (greeting reset + self-introduction)
 * from the START of an assistant answer, mid-conversation only. Paragraphs are
 * dropped one by one while MORE content follows — the response itself is never
 * nuked: if the whole text is just a greeting, it is kept as-is.
 */
export function stripLeadingIntroReset(text: string): string {
  let out = text
  for (let i = 0; i < 3; i++) {
    const m = out.match(/^\s*([^\n]+(?:\n(?!\n)[^\n]*)*)/)
    if (!m) break
    const para = m[1]
    const rest = out.slice(m[0].length)
    // Never remove the entire response — only a leading reset before real content.
    if (rest.trim().length === 0) break
    if (para.length > 600) break
    if (!INTRO_PARAGRAPH_RE.test(para)) break
    out = rest.replace(/^\s+/, '')
  }
  return out
}

/**
 * Real-time streaming sanitizer to strip fake tool-call pseudo-XML tokens
 * as text chunks arrive from the model during SSE streaming.
 */
export class StreamTextSanitizer {
  private buffer = ''
  private stripIntro: boolean
  private introChecked = false
  private head = ''

  constructor(opts?: { stripLeadingIntroReset?: boolean }) {
    this.stripIntro = !!opts?.stripLeadingIntroReset
  }

  /**
   * Processes an incoming text delta. Returns the sanitized text delta
   * safe to immediately stream to the client.
   */
  process(delta: string): string {
    // Greeting-reset enforcement: hold the very start of the stream until we
    // can decide whether it opens with intro fluff.
    if (this.stripIntro && !this.introChecked) {
      this.head += delta
      // Fast path: enough text and clearly not an intro reset → stream now.
      if (this.head.length >= 30 && !INTRO_START_RE.test(this.head)) {
        const incoming = this.head
        this.head = ''
        this.introChecked = true
        this.buffer += incoming
      } else {
        const decisive =
          this.head.includes('\n\n') || this.head.length >= 1200
        if (!decisive) return ''
        const stripped = stripLeadingIntroReset(this.head)
        if (
          stripped === this.head &&
          INTRO_START_RE.test(this.head) &&
          this.head.length < 1200
        ) {
          // Opening is intro fluff but real content hasn't arrived yet —
          // keep holding so the greeting never flashes on screen. flush()
          // will release it if nothing else ever comes.
          return ''
        }
        this.head = ''
        this.introChecked = true
        if (!stripped) return ''
        this.buffer += stripped
      }
    } else {
      this.buffer += delta
    }

    // 1. If buffer has any complete fake tool call blocks or closed tags
    const hasClosedFakeTag =
      this.buffer.includes('</invoke>') ||
      this.buffer.includes('</tool_call>') ||
      this.buffer.includes('</tool_calls>') ||
      this.buffer.includes('</function>') ||
      this.buffer.includes('</tool-search>') ||
      this.buffer.includes('<tool_call>') ||
      this.buffer.includes('<tool_calls>') ||
      this.buffer.includes('<tool-search>') ||
      this.buffer.includes('/>')

    if (hasClosedFakeTag) {
      const cleaned = stripFakeToolCallXml(this.buffer)
      this.buffer = ''
      return cleaned
    }

    // 2. If buffer has an unclosed fake tool tag (<tool_call... or </tool_call...)
    const hasOpenToolTag =
      this.buffer.includes('<tool_call') ||
      this.buffer.includes('</tool_call') ||
      this.buffer.includes('<tool_calls') ||
      this.buffer.includes('</tool_calls') ||
      this.buffer.includes('<invoke') ||
      this.buffer.includes('</invoke') ||
      this.buffer.includes('<function') ||
      this.buffer.includes('</function') ||
      this.buffer.includes('<tool-search') ||
      this.buffer.includes('</tool-search')

    if (hasOpenToolTag) {
      // If buffer is growing very large (> 300 chars) or has double newline, flush cleaned
      if (this.buffer.length > 300 || this.buffer.includes('\n\n')) {
        const cleaned = stripFakeToolCallXml(this.buffer)
        this.buffer = ''
        return cleaned
      }
      // Hold in buffer until the tag completes
      return ''
    }

    // 3. Check if buffer ends with a partial tag starting with '<'
    const lastOpenBracket = this.buffer.lastIndexOf('<')
    if (lastOpenBracket !== -1 && !this.buffer.includes('>', lastOpenBracket)) {
      const potentialTag = this.buffer.slice(lastOpenBracket)
      const matchesPotential =
        '<tool_call'.startsWith(potentialTag) ||
        '</tool_call'.startsWith(potentialTag) ||
        '<tool_calls'.startsWith(potentialTag) ||
        '</tool_calls'.startsWith(potentialTag) ||
        '<invoke'.startsWith(potentialTag) ||
        '</invoke'.startsWith(potentialTag) ||
        '<function'.startsWith(potentialTag) ||
        '</function'.startsWith(potentialTag) ||
        '<tool-search'.startsWith(potentialTag) ||
        '</tool-search'.startsWith(potentialTag)

      if (matchesPotential) {
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
    let tail = this.buffer
    this.buffer = ''
    if (this.stripIntro && !this.introChecked) {
      tail = stripLeadingIntroReset(this.head + tail)
      this.head = ''
      this.introChecked = true
    }
    const remaining = stripFakeToolCallXml(tail)
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

/**
 * Expands short follow-up search queries (e.g. "recherche leur image", "combien ça coûte ?")
 * with the subject/entities from previous conversation turns.
 */
export function resolveContextualSearchQuery(
  userQuery: string,
  history: UIMessage[] = []
): string {
  const q = userQuery.trim()
  if (!q) return ''

  const hasPronounOrFollowUp =
    /\b(leur|leurs|son|sa|ses|ça|ce|cet|cette|ces|eux|elle|elles|il|ils|lui|it|its|they|their|them|this|that|these|those|images?|photos?|pictures?|prix|combien|caract[eé]ristiques?)\b/i.test(
      q
    )

  if (history.length > 1 && (hasPronounOrFollowUp || q.split(/\s+/).length <= 4)) {
    const previousUserMessages = history
      .slice(0, -1)
      .filter(m => m.role === 'user')
    const lastUser = previousUserMessages[previousUserMessages.length - 1]
    if (lastUser) {
      const prevText = getTextFromParts(lastUser.parts).trim()
      if (prevText) {
        // Never merge with a pure greeting: "bonjour" then "Elon Musk" must
        // search "Elon Musk", NOT "bonjour Elon Musk" / "bonjour images".
        if (isPureGreeting(prevText)) {
          return q
        }
        const cleanPrev = prevText
          .replace(
            /\b(cherche|recherche|trouve|search|find|show|montre|donne|donne-moi|give|qu'est[- ]ce|what\s+is|what\s+did|tell\s+me|about)\b/gi,
            ''
          )
          .replace(/[?!.]+$/, '')
          .trim()

        if (/\b(images?|photos?|pictures?|illustrations?)\b/i.test(q)) {
          // The query mentions images BUT may already carry its own subject
          // (e.g. "montre-moi une image d'Elon Musk"). In that case keep the
          // current query as-is — do NOT replace it with "<prev> images".
          if (hasOwnImageSubject(q)) {
            return q
          }
          return `${cleanPrev} images`
        }
        return `${cleanPrev} ${q}`
      }
    }
  }

  return q
}

/**
 * Returns true when an image-related query already names its own subject
 * (e.g. "image d'Elon Musk", "photos de la Tour Eiffel"). Strips command
 * verbs, image words and stopwords — if anything meaningful remains, the
 * subject is in the current query and history must NOT override it.
 */
function hasOwnImageSubject(query: string): boolean {
  const stopwords = new Set([
    'de',
    'des',
    'du',
    'la',
    'le',
    'les',
    'un',
    'une',
    'moi',
    'me',
    'te',
    'toi',
    'nous',
    'vous',
    'stp',
    'svp',
    'please',
    'avec',
    'with',
    'sur',
    'pour',
    'for',
    'the',
    'a',
    'an',
    'of',
    'et',
    'en',
    'une',
    'quelques',
    'quelque',
    'des',
    'ce',
    'cette',
    'ces',
    'cela',
    'celui',
    'celle',
    'ceux',
    'celles',
    'leur',
    'leurs',
    'son',
    'sa',
    'ses',
    'eux',
    'elle',
    'elles',
    'ils',
    'lui',
    'on',
    'mon',
    'ma',
    'mes',
    'ton',
    'ta',
    'tes'
  ])
  const cleaned = query
    .toLowerCase()
    .replace(
      /\b(cherche|recherche|chercher|trouve|trouver|montre(?:-moi)?|montrez|affiche|affichez|donne(?:-moi)?|donnez|veux|voir|search|find|show|give|get)\b/gi,
      ' '
    )
    .replace(/\b(images?|photos?|pictures?|illustrations?|visuels?|dessins?)\b/gi, ' ')
    .replace(/[’']/g, ' ')
    .replace(/[^a-zàâäéèêëîïôöùûüç0-9\s-]/gi, ' ')
  const meaningful = cleaned
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
  return meaningful.length > 0
}
