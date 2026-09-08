import PptxGen from 'pptxgenjs'

import type { DocumentAST, DocumentBlock } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

// PowerPoint is spatial, while AST v1 is linear. We map each `heading` to a new
// slide title and stream the following blocks onto that slide, spilling to a
// continuation slide on overflow. The AST contract is never extended.
const LAYOUT_W = 13.333
const LAYOUT_H = 7.5
const MARGIN_X = 0.7
const TITLE_Y = 0.55
const CONTENT_Y = 1.7
const CONTENT_W = LAYOUT_W - MARGIN_X * 2
const BODY_COLOR = '1A1A1E'
const MUTED_COLOR = '55555C'

type Slide = any

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/** Rough wrapped-text height (inches) so blocks don't overlap on a slide. */
function textHeight(text: string, fontSize: number, width = CONTENT_W): number {
  const widthPoints = width * 72
  const charWidth = fontSize * 0.5
  const charsPerLine = Math.max(8, Math.floor(widthPoints / charWidth))
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine))
  return Math.ceil(lines * fontSize * 1.25) / 72
}

export async function renderPptx(
  ast: DocumentAST,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const pptx = new PptxGen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = ast.metadata?.author ?? 'Morphic'
  pptx.title = ast.metadata?.title ?? 'Document'
  const accent = (opts.accent?.replace(/^#/, '') ?? '2563EB').toUpperCase()

  const state: { slide: Slide; y: number } = { slide: pptx.addSlide(), y: 0 }

  // Title slide.
  const titleSlide = state.slide
  titleSlide.background = { color: 'FFFFFF' }
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.28,
    h: LAYOUT_H,
    fill: { color: accent }
  })
  titleSlide.addText(ast.metadata?.title ?? 'Document', {
    x: MARGIN_X,
    y: LAYOUT_H / 2 - 1.2,
    w: CONTENT_W,
    h: 1.6,
    fontSize: 44,
    bold: true,
    color: BODY_COLOR,
    align: 'left',
    valign: 'middle'
  })
  if (ast.metadata?.author) {
    titleSlide.addText(ast.metadata.author, {
      x: MARGIN_X,
      y: LAYOUT_H / 2 + 0.7,
      w: CONTENT_W,
      h: 0.5,
      fontSize: 18,
      color: MUTED_COLOR,
      align: 'left'
    })
  }

  state.slide = pptx.addSlide()
  state.y = CONTENT_Y

  for (const block of ast.blocks) {
    await blockToPptx(pptx, state, block, accent)
    if (state.y > LAYOUT_H - 0.8) {
      state.slide = pptx.addSlide()
      state.y = CONTENT_Y
    }
  }

  const data = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(data as never)
}

function newContentSlide(
  pptx: PptxGen,
  state: { slide: Slide; y: number },
  title: string,
  accent: string
): void {
  state.slide = pptx.addSlide()
  state.slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: LAYOUT_W,
    h: 1.2,
    fill: { color: 'F7F8FA' }
  })
  state.slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.28,
    h: 1.2,
    fill: { color: accent }
  })
  state.slide.addText(title, {
    x: MARGIN_X,
    y: 0.18,
    w: CONTENT_W,
    h: 0.85,
    fontSize: 28,
    bold: true,
    color: BODY_COLOR,
    valign: 'middle'
  })
  state.y = CONTENT_Y
}

function placeText(
  state: { slide: Slide; y: number },
  text: string,
  opts: {
    fontSize?: number
    bold?: boolean
    italic?: boolean
    color?: string
    box?: boolean
  } = {}
): void {
  const fontSize = opts.fontSize ?? 18
  const h = textHeight(text, fontSize) + 0.12
  const addOpts: any = {
    x: MARGIN_X,
    y: state.y,
    w: CONTENT_W,
    h,
    fontSize,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: opts.color ?? BODY_COLOR,
    valign: 'top'
  }
  if (opts.box) {
    addOpts.fill = { color: 'F4F4F7' }
    addOpts.line = { color: 'D4D4DC', width: 1 }
    addOpts.fontFace = 'Consolas'
  }
  state.slide.addText(text, addOpts)
  state.y += h + 0.18
}

async function blockToPptx(
  pptx: PptxGen,
  state: { slide: Slide; y: number },
  b: DocumentBlock,
  accent: string
): Promise<void> {
  switch (b.type) {
    case 'heading': {
      const level = clamp(b.level, 1, 6)
      if (level <= 2) {
        // Top-level headings start a fresh, titled content slide.
        newContentSlide(pptx, state, b.text, accent)
      } else {
        placeText(state, b.text, { fontSize: 22, bold: true, color: accent })
      }
      return
    }
    case 'paragraph':
      placeText(state, b.text, { fontSize: 18 })
      return
    case 'list': {
      const items = b.items.map(t => ({
        text: t,
        options: {
          bullet: b.ordered ? { type: 'number' as const } : { code: '2022' },
          color: BODY_COLOR
        }
      }))
      const h = textHeight(b.items.join('\n'), 18) + b.items.length * 0.12
      state.slide.addText(items, {
        x: MARGIN_X + 0.2,
        y: state.y,
        w: CONTENT_W,
        h,
        fontSize: 18,
        color: BODY_COLOR,
        valign: 'top'
      })
      state.y += h + 0.2
      return
    }
    case 'table':
      placeTable(state, b.headers, b.rows, accent)
      return
    case 'quote':
      placeText(state, b.text, {
        fontSize: 18,
        italic: true,
        color: MUTED_COLOR
      })
      return
    case 'code': {
      const h = textHeight(b.code, 14) + 0.24
      state.slide.addText(b.code, {
        x: MARGIN_X,
        y: state.y,
        w: CONTENT_W,
        h,
        fontSize: 14,
        fontFace: 'Consolas',
        fill: { color: 'F4F4F7' },
        line: { color: 'D4D4DC', width: 1 },
        color: BODY_COLOR,
        valign: 'top'
      })
      state.y += h + 0.2
      return
    }
    case 'image': {
      const img = imageSource(b.url)
      if (!img) {
        placeText(state, `[image: ${b.alt ?? b.url}]`, {
          fontSize: 16,
          italic: true,
          color: MUTED_COLOR
        })
        return
      }
      const w = 6.2
      const hgt = 3.6
      state.slide.addImage({ ...img, x: MARGIN_X, y: state.y, w, h: hgt })
      state.y += hgt + 0.25
      return
    }
    case 'pageBreak':
      state.slide = pptx.addSlide()
      state.y = CONTENT_Y
      return
  }
}

function placeTable(
  state: { slide: Slide; y: number },
  headers: string[],
  rows: string[][],
  accent: string
): void {
  const body: any[] = [
    headers.map(h => ({
      text: h,
      options: { bold: true, fill: { color: accent }, color: 'FFFFFF' }
    })),
    ...rows.map(r => r.map(c => ({ text: c, options: { color: BODY_COLOR } })))
  ]
  const h = Math.max(1, headers.length + rows.length) * 0.45 + 0.2
  state.slide.addTable(body, {
    x: MARGIN_X,
    y: state.y,
    w: CONTENT_W,
    fontSize: 14,
    border: { type: 'solid', color: 'D4D4DC', pt: 1 },
    color: BODY_COLOR,
    valign: 'middle'
  })
  state.y += h + 0.25
}

/**
 * Resolve an image into a pptxgenjs `ImageProps` source.
 *  - data: URL → pass the base64 body directly
 *  - http(s)   → let pptxgenjs fetch it via `path`
 *  - otherwise  → null (caller keeps a textual trace)
 */
function imageSource(url: string): { data?: string; path?: string } | null {
  const dataMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url)
  if (dataMatch) return { data: `${dataMatch[1]};base64,${dataMatch[2]}` }
  if (/^https?:\/\//i.test(url)) return { path: url }
  return null
}

/** PPTX (spatial slides) can represent every AST v1 block; breaks become slides. */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: true,
  supportsPageBreak: true,
  isSpatial: true
}
