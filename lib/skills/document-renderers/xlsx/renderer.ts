import ExcelJS from 'exceljs'

import type { DocumentAST, DocumentBlock } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

// AST v1 is semantic; this renderer owns the spatial representation of an
// Excel workbook. A single row cursor walks the active worksheet and a
// pageBreak opens a fresh sheet. No Excel-specific concept leaks into the AST.
const MERGE_COLS = 8

type XlsxState = {
  wb: ExcelJS.Workbook
  ws: ExcelJS.Worksheet
  row: number
  tableIndex: number
}

function hexToArgb(hex: string): string {
  const clean = hex.replace(/^#/, '').toUpperCase()
  return `FF${clean}`
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function safeSheetName(title: string | undefined): string {
  const base = (title ?? 'Document')
    .slice(0, 28)
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
  return base || 'Document'
}

/**
 * XLSX renderer (AST → .xlsx). Pure transformation: it receives a DocumentAST
 * and emits a real Excel workbook via `exceljs`. It never decides document
 * structure — only `AST → target format`.
 *
 *    DocumentAST
 *      ├── heading    → merged + styled row
 *      ├── paragraph  → cell / row
 *      ├── list       → rows
 *      ├── table      → native Excel table
 *      ├── quote      → styled cell
 *      ├── code       → monospace cell
 *      ├── image      → embedded image
 *      └── pageBreak  → new worksheet
 *                       │
 *                       ▼
 *                     .xlsx
 */
export async function renderXlsx(
  ast: DocumentAST,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const state: XlsxState = {
    wb,
    ws: wb.addWorksheet(safeSheetName(ast.metadata?.title)),
    row: 1,
    tableIndex: 1
  }
  const accent = hexToArgb(opts.accent ?? '#2563EB')

  for (const block of ast.blocks) {
    await blockToXlsx(state, block, accent)
  }

  // Post-process: auto-fit column widths, freeze the first row, and give every
  // sheet a readable default font so generated workbooks look intentional.
  for (const ws of wb.worksheets) {
    ws.eachRow(row => {
      row.eachCell(cell => {
        const len = String(cell.value ?? '').length
        const col = ws.getColumn(cell.col)
        const current = col.width ?? 10
        col.width = Math.min(60, Math.max(current, len + 2))
      })
    })
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

async function blockToXlsx(
  state: XlsxState,
  b: DocumentBlock,
  accent: string
): Promise<void> {
  const { ws } = state
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 1), 6)
      const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
      ws.mergeCells(range)
      const cell = ws.getCell(`A${state.row}`)
      cell.value = b.text
      cell.font = {
        bold: true,
        size: level === 1 ? 16 : 13,
        color: { argb: accent }
      }
      state.row += 1
      return
    }
    case 'paragraph': {
      const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
      ws.mergeCells(range)
      const cell = ws.getCell(`A${state.row}`)
      cell.value = b.text
      cell.alignment = { wrapText: true, vertical: 'top' }
      state.row += 1
      return
    }
    case 'list': {
      b.items.forEach((item, i) => {
        const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
        ws.mergeCells(range)
        ws.getCell(`A${state.row}`).value = b.ordered
          ? `${i + 1}. ${item}`
          : `• ${item}`
        state.row += 1
      })
      return
    }
    case 'table': {
      const ref = `A${state.row}`
      ws.addTable({
        name: `T${state.tableIndex}`,
        ref,
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: b.headers.map(h => ({ name: h })),
        rows: b.rows
      })
      state.tableIndex += 1
      state.row += b.rows.length + 2
      return
    }
    case 'quote': {
      const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
      ws.mergeCells(range)
      const cell = ws.getCell(`A${state.row}`)
      cell.value = b.text
      cell.font = { italic: true, color: { argb: 'FF55555C' } }
      cell.alignment = { wrapText: true, vertical: 'top' }
      state.row += 1
      return
    }
    case 'code': {
      const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
      ws.mergeCells(range)
      const cell = ws.getCell(`A${state.row}`)
      cell.value = b.code
      cell.font = { name: 'Courier New', color: { argb: 'FF1A1A1E' } }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF4F4F7' }
      }
      cell.alignment = { wrapText: true, vertical: 'top' }
      state.row += 1
      return
    }
    case 'image': {
      const img = await imageSource(b.url)
      const top = state.row - 1
      if (img) {
        const id = state.wb.addImage(img)
        state.ws.addImage(id, {
          tl: { col: 0, row: top },
          ext: { width: 360, height: 240 }
        })
      } else {
        const range = `A${state.row}:${colLetter(MERGE_COLS)}${state.row}`
        ws.mergeCells(range)
        ws.getCell(`A${state.row}`).value = `[image: ${b.alt ?? b.url}]`
      }
      state.row += 13
      return
    }
    case 'pageBreak': {
      state.ws = state.wb.addWorksheet(
        `Sheet ${state.wb.worksheets.length + 1}`
      )
      state.row = 1
      return
    }
  }
}

/**
 * Resolve an image into an exceljs `Image`.
 *  - data: URL → decode base64 (png/jpeg/gif)
 *  - http(s)   → fetch bytes
 *  - otherwise  → null (caller keeps a textual trace)
 */
async function imageSource(url: string): Promise<ExcelJS.Image | null> {
  const dataMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url)
  if (dataMatch) {
    const ext =
      dataMatch[1] === 'image/png'
        ? 'png'
        : dataMatch[1] === 'image/gif'
          ? 'gif'
          : 'jpeg'
    return { extension: ext, base64: dataMatch[2] }
  }
  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const mime = res.headers.get('content-type') ?? ''
      const ext = mime.includes('png')
        ? 'png'
        : mime.includes('gif')
          ? 'gif'
          : 'jpeg'
      const buf = Buffer.from(await res.arrayBuffer())
      return { extension: ext, base64: buf.toString('base64') }
    } catch {
      return null
    }
  }
  return null
}

/** XLSX (spreadsheet) represents every AST v1 block as rows/cells; breaks become sheets. */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: true,
  supportsPageBreak: true,
  isSpreadsheet: true
}
