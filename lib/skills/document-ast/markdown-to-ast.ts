import type { DocumentAST, DocumentBlock } from './types'

/**
 * Parse a Markdown string into a Document AST. This is intentionally
 * self-contained (no dependency on the PDF renderer) so the AST is the single
 * source of truth that every renderer consumes.
 */
export function markdownToAst(src: string): DocumentAST {
  const lines = src.split(/\r?\n/)
  const blocks: DocumentBlock[] = []
  const metadata: { title?: string; author?: string; language?: string } = {}
  let i = 0

  const isSpecial = (l: string) =>
    /^(#{1,6})\s+/.test(l) ||
    /^\s*```/.test(l) ||
    /^\s*>\s?/.test(l) ||
    /^\s*([-*+]\s+)/.test(l) ||
    /^\s*\d+[.)]\s+/.test(l) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) ||
    /^\s*\|.*\|\s*$/.test(l)

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++
      blocks.push({
        type: 'code',
        language: lang || undefined,
        code: buf.join('\n')
      })
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const text = h[2].trim()
      if (level === 1 && !metadata.title && blocks.length === 0)
        metadata.title = text
      blocks.push({ type: 'heading', level, text })
      i++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      i++
      continue
    }

    const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim())
    if (img) {
      blocks.push({ type: 'image', url: img[2], alt: img[1] || undefined })
      i++
      continue
    }

    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      const buf = [q[1]]
      i++
      let mm: RegExpExecArray | null
      while (i < lines.length && (mm = /^>\s?(.*)$/.exec(lines[i]))) {
        buf.push(mm[1])
        i++
      }
      blocks.push({ type: 'quote', text: buf.join(' ') })
      continue
    }

    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', headers: header, rows })
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      const items: string[] = []
      while (i < lines.length && /^(\s*)[-*+]\s+(.*)$/.exec(lines[i])) {
        const mm = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i])!
        items.push(mm[2].trim())
        i++
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    const ord = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (ord) {
      const items: string[] = []
      while (i < lines.length && /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[i])) {
        const mm = /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[i])!
        items.push(mm[2].trim())
        i++
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    const buf = [line]
    i++
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !isSpecial(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', text: buf.join(' ') })
  }

  const ast: DocumentAST = { type: 'document', blocks }
  if (metadata.title || metadata.author || metadata.language)
    ast.metadata = metadata
  return ast
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim())
}
