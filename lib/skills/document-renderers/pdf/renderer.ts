import { astToMarkdown } from '../../document-ast/ast-to-markdown'
import type { DocumentAST } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'
import { createDocument } from '../../document-runtime'

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

/**
 * PDF capability declaration. The current adapter renders the AST as Markdown
 * and delegates to the stabilized PDF engine (pdf-lib / Playwright). It covers
 * the full text/structure block set, but does NOT yet embed images or propagate
 * page breaks through the markdown→legacy path — those stay out of contract.
 */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: false,
  supportsPageBreak: false
}

/**
 * PDF renderer (adapter). Converts the AST to Markdown and delegates to the
 * existing, stabilized PDF engine (pdf-lib / Playwright). Keeps the PDF output
 * exactly as it is today — no regression.
 */
export async function renderPdf(ast: DocumentAST, opts: RenderOptions = {}): Promise<Buffer> {
  const spec: Record<string, unknown> = { content: astToMarkdown(ast) }
  if (opts.premium) spec.premium = true
  if (opts.template) spec.template = opts.template
  if (opts.accent) spec.accent = opts.accent
  return createDocument('pdf', spec)
}
