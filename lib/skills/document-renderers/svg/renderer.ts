import type { DocumentAST, DocumentBlock } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

// SVG is a free 2D format, so this renderer owns a tiny layout engine: a single
// vertical cursor places each block, and a pageBreak drops a separator + gap.
// No SVG-specific concept leaks into the AST — the contract stays semantic.
const W = 800
const MARGIN = 40
const CONTENT_W = W - MARGIN * 2

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escAttr(s: string): string {
  return esc(s).replace(/'/g, '&apos;')
}

/** Greedy word-wrap to fit `CONTENT_W` at the given font size. */
function wrap(text: string, fontSize: number): string[] {
  const charW = fontSize * 0.55
  const cpl = Math.max(8, Math.floor(CONTENT_W / charW))
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= cpl) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function textBlock(
  lines: string[],
  x: number,
  top: number,
  fontSize: number,
  opts: { color?: string; weight?: string; style?: string } = {}
): string {
  const lh = fontSize * 1.3
  const tspans = lines
    .map((ln, i) =>
      i === 0
        ? `<tspan x="${x}" y="${(top + fontSize).toFixed(1)}">${esc(ln)}</tspan>`
        : `<tspan x="${x}" dy="${lh.toFixed(1)}">${esc(ln)}</tspan>`
    )
    .join('')
  return `<text font-family="sans-serif" font-size="${fontSize}" fill="${opts.color ?? '#1A1A1E'}" font-weight="${opts.weight ?? 'normal'}" font-style="${opts.style ?? 'normal'}">${tspans}</text>`
}

/**
 * SVG renderer (AST → .svg). Pure transformation: it receives a DocumentAST and
 * emits a single free-form SVG document built from `<text>`, `<rect>`, `<line>`
 * and `<image>` primitives. It never decides document structure — only
 * `AST → target format`.
 *
 *    DocumentAST
 *      ├── heading    → <text>
 *      ├── paragraph  → <text>
 *      ├── list       → <text> + bullet/number
 *      ├── table      → <rect> grid + <text>
 *      ├── quote      → <rect> + italic <text>
 *      ├── code       → <rect> + monospace <text>
 *      ├── image      → <image>
 *      └── pageBreak  → separator + new SVG zone
 *                       │
 *                       ▼
 *                      <svg>
 */
export async function renderSvg(
  ast: DocumentAST,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const accent = opts.accent?.replace(/^#/, '') ?? '2563EB'
  const parts: string[] = []
  let y = MARGIN

  if (ast.metadata?.title && ast.blocks[0]?.type !== 'heading') {
    const lines = wrap(ast.metadata.title, 28)
    parts.push(
      textBlock(lines, MARGIN, y, 28, { weight: 'bold', color: `#${accent}` })
    )
    y += lines.length * 28 * 1.3 + 12
  }

  for (const block of ast.blocks) {
    y = blockToSvg(parts, y, block, accent)
  }

  const height = Math.ceil(y + MARGIN)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="sans-serif">\n` +
    parts.join('\n') +
    '\n</svg>'
  return Buffer.from(svg, 'utf-8')
}

function blockToSvg(
  parts: string[],
  y: number,
  b: DocumentBlock,
  accent: string
): number {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 1), 6)
      const size = level === 1 ? 28 : level === 2 ? 22 : level === 3 ? 18 : 16
      const lines = wrap(b.text, size)
      parts.push(
        textBlock(lines, MARGIN, y, size, {
          weight: 'bold',
          color: `#${accent}`
        })
      )
      return y + lines.length * size * 1.3 + 10
    }
    case 'paragraph': {
      const lines = wrap(b.text, 14)
      parts.push(textBlock(lines, MARGIN, y, 14))
      return y + lines.length * 14 * 1.3 + 8
    }
    case 'list': {
      const render = (item: string, i: number) =>
        b.ordered ? `${i + 1}. ${item}` : `• ${item}`
      const lines: string[] = []
      b.items.forEach((item, i) => {
        wrap(render(item, i), 14).forEach(l => lines.push(l))
      })
      parts.push(textBlock(lines, MARGIN, y, 14))
      return y + lines.length * 14 * 1.3 + 8
    }
    case 'table': {
      const colCount = Math.max(
        b.headers.length,
        ...b.rows.map(r => r.length),
        1
      )
      const cellW = CONTENT_W / colCount
      const lh = 16
      let rowTop = y
      const rows = [b.headers, ...b.rows]
      rows.forEach((row, ri) => {
        const textLines = Math.max(
          1,
          ...row.map(c => wrap(String(c ?? ''), 12).length)
        )
        const rowH = textLines * lh + 10
        const fill = ri === 0 ? '#EEEEF2' : ri % 2 === 0 ? '#F7F7F9' : '#FFFFFF'
        parts.push(
          `<rect x="${MARGIN}" y="${rowTop.toFixed(1)}" width="${CONTENT_W}" height="${rowH.toFixed(1)}" fill="${fill}" stroke="#CCCCCC" stroke-width="1"/>`
        )
        row.forEach((cell, ci) => {
          const cellLines = wrap(String(cell ?? ''), 12)
          const tspans = cellLines
            .map((ln, li) =>
              li === 0
                ? `<tspan x="${(MARGIN + 6 + ci * cellW).toFixed(1)}" y="${(rowTop + 14).toFixed(1)}">${esc(ln)}</tspan>`
                : `<tspan x="${(MARGIN + 6 + ci * cellW).toFixed(1)}" dy="${lh}">${esc(ln)}</tspan>`
            )
            .join('')
          parts.push(
            `<text font-size="12" fill="#1A1A1E" font-weight="${ri === 0 ? 'bold' : 'normal'}">${tspans}</text>`
          )
          if (ci > 0) {
            parts.push(
              `<line x1="${(MARGIN + ci * cellW).toFixed(1)}" y1="${rowTop.toFixed(1)}" x2="${(MARGIN + ci * cellW).toFixed(1)}" y2="${(rowTop + rowH).toFixed(1)}" stroke="#CCCCCC" stroke-width="1"/>`
            )
          }
        })
        rowTop += rowH
      })
      return rowTop + 10
    }
    case 'quote': {
      const lines = wrap(b.text, 14)
      const boxH = lines.length * 14 * 1.3 + 12
      parts.push(
        `<rect x="${MARGIN}" y="${y.toFixed(1)}" width="${CONTENT_W}" height="${boxH.toFixed(1)}" fill="#F4F4F7" stroke="#${accent}" stroke-width="1"/>`
      )
      parts.push(
        textBlock(lines, MARGIN + 10, y + 6, 14, {
          style: 'italic',
          color: '#55555C'
        })
      )
      return y + boxH + 8
    }
    case 'code': {
      const lines = wrap(b.code, 12)
      const boxH = lines.length * 12 * 1.3 + 12
      parts.push(
        `<rect x="${MARGIN}" y="${y.toFixed(1)}" width="${CONTENT_W}" height="${boxH.toFixed(1)}" fill="#F4F4F7" stroke="#CCCCCC" stroke-width="1"/>`
      )
      const codeText = textBlock(lines, MARGIN + 8, y + 6, 12, {
        color: '#1A1A1E'
      })
      parts.push(codeText.replace('<text ', '<text font-family="monospace" '))
      return y + boxH + 8
    }
    case 'image': {
      const h = 200
      parts.push(
        `<image href="${escAttr(b.url)}" x="${MARGIN}" y="${y.toFixed(1)}" width="320" height="${h}" preserveAspectRatio="xMidYMid meet"/>`
      )
      return y + h + 10
    }
    case 'pageBreak': {
      const sepY = y + 4
      parts.push(
        `<line x1="${MARGIN}" y1="${sepY.toFixed(1)}" x2="${(W - MARGIN).toFixed(1)}" y2="${sepY.toFixed(1)}" stroke="#CCCCCC" stroke-width="1" class="page-break"/>`
      )
      return y + 40
    }
  }
}

/** SVG (vector) can represent every AST v1 block as free-form graphical primitives. */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: true,
  supportsPageBreak: true,
  isVector: true
}
