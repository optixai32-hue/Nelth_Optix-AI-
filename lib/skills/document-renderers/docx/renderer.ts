import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

import type { DocumentAST, DocumentBlock } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

/**
 * Ordered-list numbering definition. Referenced by list blocks via
 * `numbering: { reference: 'docx-ordered' }`. Bulleted lists use the built-in
 * `bullet` shorthand and need no explicit config.
 */
const ORDERED_NUMBERING_CONFIG = [
  {
    reference: 'docx-ordered',
    levels: [
      {
        level: 0,
        format: 'decimal' as const,
        text: '%1.',
        alignment: 'start' as const,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }
    ]
  }
]

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

type HeadingValue = (typeof HeadingLevel)[keyof typeof HeadingLevel]

const HEADING_BY_LEVEL: Record<number, HeadingValue> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
}

/**
 * DOCX renderer (AST → .docx). Pure transformation: it receives a DocumentAST
 * and emits a real Office Open XML word-processing document via the `docx`
 * library. It never decides document structure — only `AST → target format`.
 *
 *    DocumentAST
 *      ├── heading    → Heading
 *      ├── paragraph  → Paragraph
 *      ├── list       → List
 *      ├── table      → Table
 *      ├── quote      → styled paragraph
 *      ├── code       → code paragraph
 *      ├── image      → Image
 *      └── pageBreak  → PageBreak
 *                       │
 *                       ▼
 *                     .docx
 */
function hexToRgb(hex: string | undefined, fallback = '2563EB'): string {
  const clean = (hex ?? fallback).replace(/^#/, '')
  return clean.length === 3
    ? clean
        .split('')
        .map(c => c + c)
        .join('')
        .toUpperCase()
    : clean.slice(0, 6).toUpperCase()
}

export async function renderDocx(
  ast: DocumentAST,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const accent = hexToRgb(opts.accent)
  const children: (Paragraph | Table)[] = []

  // Mirror the Markdown renderer: surface the metadata title as the leading H1
  // only when the body does not already open with a heading.
  const startsWithHeading = ast.blocks[0]?.type === 'heading'
  if (ast.metadata?.title && !startsWithHeading) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: ast.metadata.title, color: accent })]
      })
    )
  }

  for (const block of ast.blocks) {
    const rendered = await blockToDocx(block, accent)
    if (rendered) children.push(...rendered)
  }

  const doc = new Document({
    numbering: { config: ORDERED_NUMBERING_CONFIG },
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '1A1A1E' },
          paragraph: { spacing: { after: 160, line: 276 } }
        }
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 40, bold: true, color: accent },
          paragraph: { spacing: { before: 280, after: 140 } }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, color: accent },
          paragraph: { spacing: { before: 240, after: 120 } }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, color: accent },
          paragraph: { spacing: { before: 200, after: 100 } }
        }
      ]
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }
        },
        children
      }
    ]
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

async function blockToDocx(
  b: DocumentBlock,
  accent: string
): Promise<(Paragraph | Table)[]> {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 1), 6)
      return [
        new Paragraph({
          heading: HEADING_BY_LEVEL[level],
          children: [new TextRun({ text: b.text, color: accent })]
        })
      ]
    }
    case 'paragraph':
      return [new Paragraph({ children: [new TextRun(b.text)] })]
    case 'list':
      return b.items.map(item =>
        b.ordered
          ? new Paragraph({
              text: item,
              numbering: { reference: 'docx-ordered', level: 0 },
              spacing: { after: 80 }
            })
          : new Paragraph({
              text: item,
              bullet: { level: 0 },
              spacing: { after: 80 }
            })
      )
    case 'table':
      return [blockToTable(b, accent)]
    case 'quote':
      return [
        new Paragraph({
          children: [
            new TextRun({ text: b.text, italics: true, color: '55555C' })
          ],
          indent: { left: 720 },
          border: { left: { color: accent, style: 'single', size: 24 } },
          spacing: { before: 80, after: 160 }
        })
      ]
    case 'code':
      return [
        new Paragraph({
          children: [new TextRun({ text: b.code, font: 'Consolas' })],
          shading: { type: 'solid', color: 'F4F4F7', fill: 'F4F4F7' },
          border: { left: { color: 'D4D4DC', style: 'single', size: 12 } },
          spacing: { before: 80, after: 160 }
        })
      ]
    case 'image': {
      const run = await buildImageRun(b.url, b.alt)
      if (run)
        return [new Paragraph({ children: [run], spacing: { after: 160 } })]
      // Graceful fallback: keep a trace of the image instead of dropping it.
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `[image: ${b.alt ?? b.url}]`, italics: true })
          ]
        })
      ]
    }
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })]
  }
}

const TABLE_BORDER = { style: 'single' as const, size: 4, color: 'D4D4DC' }

function blockToTable(
  b: Extract<DocumentBlock, { type: 'table' }>,
  accent: string
): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: b.headers.map(h => cell(h, true, accent))
  })
  const bodyRows = b.rows.map(
    r => new TableRow({ children: r.map(c => cell(c, false, accent)) })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER
    },
    rows: [headerRow, ...bodyRows]
  })
}

function cell(text: string, header: boolean, accent: string): TableCell {
  return new TableCell({
    shading: header
      ? { type: 'solid', color: accent, fill: accent }
      : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: header,
            color: header ? 'FFFFFF' : '1A1A1E'
          })
        ]
      })
    ]
  })
}

function imageTypeFromMime(mime: string): 'png' | 'jpg' | 'gif' | 'bmp' | null {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/bmp') return 'bmp'
  return null
}

async function resolveImageBytes(
  url: string
): Promise<{ data: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> {
  // data: URL → decode inline base64 (no network).
  const dataMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url)
  if (dataMatch) {
    const type = imageTypeFromMime(dataMatch[1])
    if (!type) return null
    try {
      return { data: Buffer.from(dataMatch[2], 'base64'), type }
    } catch {
      return null
    }
  }
  // http(s) URL → fetch bytes.
  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const mime = res.headers.get('content-type') ?? ''
      const type = imageTypeFromMime(mime) ?? 'png'
      const buf = Buffer.from(await res.arrayBuffer())
      return { data: buf, type }
    } catch {
      return null
    }
  }
  return null
}

async function buildImageRun(
  url: string,
  alt?: string
): Promise<ImageRun | null> {
  const resolved = await resolveImageBytes(url)
  if (!resolved) return null
  try {
    return new ImageRun({
      type: resolved.type,
      data: resolved.data,
      transformation: { width: 480, height: 320 },
      altText: alt ? { title: alt, description: alt, name: alt } : undefined
    })
  } catch {
    return null
  }
}

/** DOCX (Office Open XML) can represent every AST v1 block. */
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
