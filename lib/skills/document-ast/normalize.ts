import { markdownToAst } from './markdown-to-ast'
import { documentAstSchema } from './schema'
import type { DocumentAST } from './types'

/** True when the value already looks like a Document AST (has `blocks`). */
export function isAst(value: unknown): value is DocumentAST {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'blocks' in (value as Record<string, unknown>) &&
    Array.isArray((value as Record<string, unknown>).blocks)
  )
}

/**
 * True for the legacy `createDocument` spec shapes (content/paragraphs/sections/…).
 * These are passed straight through to the existing renderers so behavior is
 * unchanged during the migration.
 */
export function isLegacySpec(content: unknown): boolean {
  if (typeof content === 'string') return false
  if (Array.isArray(content)) return false
  if (isAst(content)) return false
  return typeof content === 'object' && content !== null
}

/** Normalize any supported input (Markdown string or AST) into a Document AST. */
export function normalizeToAst(content: unknown): DocumentAST {
  if (typeof content === 'string') return markdownToAst(content)
  if (isAst(content)) return content
  // Unknown object: treat as empty document rather than throwing.
  return { type: 'document', blocks: [] }
}

/** Validate an AST, throwing a descriptive error when invalid. */
export function validateAst(ast: DocumentAST): DocumentAST {
  const result = documentAstSchema.safeParse(ast)
  if (!result.success) {
    throw new Error(`Invalid Document AST: ${result.error.message}`)
  }
  return result.data
}
