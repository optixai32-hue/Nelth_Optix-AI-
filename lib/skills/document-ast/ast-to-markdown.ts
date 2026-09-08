import type { DocumentAST, DocumentBlock } from './types'

/** Serialize a Document AST back to Markdown (used by the PDF/Markdown renderers). */
export function astToMarkdown(ast: DocumentAST): string {
  const out: string[] = []
  // Emit the metadata title as the leading H1 only if the body does not already
  // open with a heading (avoids a duplicated top-level title).
  const startsWithHeading = ast.blocks[0]?.type === 'heading'
  if (ast.metadata?.title && !startsWithHeading) {
    out.push(`# ${ast.metadata.title}`, '')
  }
  for (const b of ast.blocks) {
    out.push(...blockToMarkdown(b))
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function blockToMarkdown(b: DocumentBlock): string[] {
  switch (b.type) {
    case 'heading':
      return [`${'#'.repeat(Math.min(Math.max(b.level, 1), 6))} ${b.text}`, '']
    case 'paragraph':
      return [b.text, '']
    case 'list':
      return [
        ...b.items.map((it, idx) =>
          b.ordered ? `${idx + 1}. ${it}` : `- ${it}`
        ),
        ''
      ]
    case 'quote':
      return [
        b.text
          .split('\n')
          .map(l => `> ${l}`)
          .join('\n'),
        ''
      ]
    case 'code':
      return [`\`\`\`${b.language ?? ''}\n${b.code}\n\`\`\``, '']
    case 'table': {
      const head = `| ${b.headers.join(' | ')} |`
      const sep = `| ${b.headers.map(() => '---').join(' | ')} |`
      const rows = b.rows.map(r => `| ${r.join(' | ')} |`)
      return [head, sep, ...rows, '']
    }
    case 'image':
      return [`![${b.alt ?? ''}](${b.url})`, '']
    case 'pageBreak':
      return ['', '<!-- page break -->', '']
  }
}

/**
 * Convert an AST into the legacy `createDocument` spec shape so that formats
 * without a dedicated renderer still render through the existing engines.
 */
export function astToLegacySpec(
  ast: DocumentAST,
  opts?: { premium?: boolean; template?: string; accent?: string }
): Record<string, unknown> {
  const spec: Record<string, unknown> = { content: astToMarkdown(ast) }
  if (opts?.premium) spec.premium = true
  if (opts?.template) spec.template = opts.template
  if (opts?.accent) spec.accent = opts.accent
  return spec
}
