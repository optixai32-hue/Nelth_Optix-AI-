import { astToMarkdown } from '../../document-ast/ast-to-markdown'
import type { DocumentAST } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

/** Markdown renderer — serializes the AST back to a Markdown document. */
export async function renderMarkdown(ast: DocumentAST): Promise<Buffer> {
  return Buffer.from(astToMarkdown(ast), 'utf-8')
}

/** Markdown is the source format: it can represent every AST v1 block. */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: true,
  supportsPageBreak: true
}
