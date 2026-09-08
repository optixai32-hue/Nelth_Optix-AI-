export const CHAT_ID = 'search' as const

/**
 * MIME types the chatbot accepts for file upload. Covers images plus the four
 * document skills (pdf / docx / xlsx / pptx). Shared by the upload API route and
 * the client upload UIs so they never drift apart.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
] as const

/** Human-readable accept string for <input type="file" accept=...>. */
export const ALLOWED_UPLOAD_ACCEPT = ALLOWED_UPLOAD_MIME_TYPES.join(',')
