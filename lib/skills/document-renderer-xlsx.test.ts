import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { DocumentAST } from './document-ast/types'
import { generateDocument } from './document-engine'
import { mimeForFormat } from './document-runtime'

/**
 * Maturity test for the XLSX renderer. Runs the SAME Document AST used by the
 * PDF / HTML / Markdown / DOCX / PPTX maturity tests and verifies the AST v1
 * contract also survives a spreadsheet format. A failure here would mean the
 * semantic AST needs an Excel-specific extension.
 */
const AST: DocumentAST = {
  type: 'document',
  metadata: { title: 'Maturity Report' },
  blocks: [
    { type: 'heading', level: 1, text: 'Architecture Maturity' },
    { type: 'paragraph', text: 'The AST is now format-agnostic.' },
    { type: 'list', ordered: false, items: ['Decoupled', 'Stable', 'Extensible'] },
    { type: 'list', ordered: true, items: ['First', 'Second'] },
    {
      type: 'table',
      headers: ['Format', 'Status'],
      rows: [
        ['PDF', 'OK'],
        ['XLSX', 'OK']
      ]
    },
    { type: 'quote', text: 'No renderer owns the document logic.' },
    { type: 'code', language: 'ts', code: 'const ast = toAst(input)' },
    {
      type: 'image',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      alt: 'pixel'
    },
    { type: 'pageBreak' },
    { type: 'paragraph', text: 'Second sheet after the page break.' }
  ]
}

async function reopenXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  const text = wb.worksheets
    .map(ws => {
      let t = ''
      ws.eachRow(row =>
        row.eachCell(cell => {
          const v = cell.value
          t += (typeof v === 'object' && v && 'text' in v ? String((v as { text: string }).text) : String(v ?? '')) + '\n'
        })
      )
      return t
    })
    .join('\n')
  const zip = await JSZip.loadAsync(buf)
  const media = Object.keys(zip.files).filter(f => /^xl\/media\//.test(f))
  return { sheetCount: wb.worksheets.length, text, media }
}

describe('XLSX renderer — AST v1 maturity test', () => {
  it('generates a non-empty .xlsx with the correct MIME type', async () => {
    const buf = await generateDocument({ format: 'xlsx', content: AST })

    expect(buf.length).toBeGreaterThan(0)
    expect(mimeForFormat('xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

    const { sheetCount, text, media } = await reopenXlsx(buf)

    expect(sheetCount).toBeGreaterThanOrEqual(2) // pageBreak created a 2nd sheet
    expect(text).toContain('Architecture Maturity') // heading
    expect(text).toContain('The AST is now format-agnostic.') // paragraph
    expect(text).toContain('• Decoupled') // bulleted list
    expect(text).toContain('1. First') // ordered list
    expect(text).toContain('Format') // table header
    expect(text).toContain('No renderer owns the document logic.') // quote
    expect(text).toContain('const ast = toAst(input)') // code
    expect(text).toContain('Second sheet after the page break.') // content after break
    expect(media.length).toBeGreaterThan(0) // image embedded
  })
})
