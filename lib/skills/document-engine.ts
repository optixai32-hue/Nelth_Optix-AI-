import type { DocumentAST } from './document-ast/types'
import { renderDocx } from './document-renderers/docx/renderer'
import { renderHtml } from './document-renderers/html/renderer'
import { renderMarkdown } from './document-renderers/markdown/renderer'
import { renderPdf } from './document-renderers/pdf/renderer'
import { renderPptx } from './document-renderers/pptx/renderer'
import { renderSvg } from './document-renderers/svg/renderer'
import { renderXlsx } from './document-renderers/xlsx/renderer'
import { astToLegacySpec,isLegacySpec, normalizeToAst, validateAst } from './document-ast'
import { hasRenderer } from './document-capabilities'
import { buildMarkdownSource,createDocument } from './document-runtime'

export interface GenerateRequest {
  format: string
  /** Markdown string, a Document AST, or a legacy `createDocument` spec. */
  content: unknown
  premium?: boolean
  template?: string
  accent?: string
}

export interface GenerateResult {
  buffer: Buffer
  via: 'legacy' | 'ast'
}

/**
 * Common entry point for every document format.
 *
 *   request → normalize → Document AST → validate → select renderer → output
 *
 * Legacy specs pass straight through to the existing renderers (zero
 * regression). AST / Markdown input flows through the AST core; formats without
 * a dedicated renderer fall back to the legacy engine via `astToLegacySpec`.
 */
const AST_RENDERERS: Record<string, (ast: DocumentAST, opts: { premium?: boolean; template?: string; accent?: string }) => Promise<Buffer>> = {
  pdf: renderPdf,
  markdown: renderMarkdown,
  html: renderHtml,
  docx: renderDocx,
  pptx: renderPptx,
  xlsx: renderXlsx,
  svg: renderSvg
}

/** Normalize legacy/string/AST input into a Markdown string for the AST path. */
function toAstInput(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (isAstContent(content)) return content
  // Legacy spec object → serialize to Markdown, then let the AST parser handle it.
  return buildMarkdownSource(content as Record<string, unknown>)
}

function isAstContent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'blocks' in (value as Record<string, unknown>)
  )
}

export async function generateDocument(req: GenerateRequest): Promise<Buffer> {
  const { format, content } = req
  const opts = { premium: req.premium, template: req.template, accent: req.accent }
  // A format is AST-native when a dedicated renderer exists for it. Derived from
  // the capability registry so the format list lives in ONE place (no hardcoded
  // branching in the core).
  const isAstFormat = hasRenderer(format)

  // Progressive migration: legacy specs keep their exact existing behavior —
  // except the AST-native formats, which always flow through the AST core.
  if (!isAstFormat && isLegacySpec(content)) {
    return createDocument(format as never, content as never)
  }

  const ast = validateAst(normalizeToAst(toAstInput(content)))
  const renderer = AST_RENDERERS[format]
  if (!renderer) {
    // No dedicated renderer yet → reuse the battle-tested legacy engine.
    return createDocument(format as never, astToLegacySpec(ast, opts) as never)
  }
  return renderer(ast, opts)
}
