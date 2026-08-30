import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { DocumentAST } from './document-ast/types'
import { generateDocument } from './document-engine'
import { mimeForFormat } from './document-runtime'

/**
 * Maturity test for the DOCX renderer.
 *
 * Runs the SAME Document AST used by the PDF / HTML / Markdown maturity test and
 * verifies the AST v1 contract is abstract enough to represent an office
 * document. Fails only if the renderer cannot emit a real, well-formed .docx
 * containing every block type — which would mean the AST contract needs fixing
 * before adding PPTX / XLSX.
 */
const AST: DocumentAST = {
  type: 'document',
  metadata: { title: 'Maturity Report' },
  blocks: [
    { type: 'heading', level: 1, text: 'Architecture Maturity' },
    { type: 'paragraph', text: 'The AST is now format-agnostic.' },
    { type: 'list', ordered: false, items: ['Decoupled', 'Stable', 'Extensible'] },
    {
      type: 'table',
      headers: ['Format', 'Status'],
      rows: [
        ['PDF', 'OK'],
        ['DOCX', 'OK']
      ]
    },
    { type: 'quote', text: 'No renderer owns the document logic.' },
    { type: 'code', language: 'ts', code: 'const ast = toAst(input)' },
    {
      type: 'image',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      alt: 'pixel'
    },
    { type: 'pageBreak' }
  ]
}

async function reopenDocx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const media = Object.keys(zip.files).filter(f => /^word\/media\//.test(f))
  return { docXml, media }
}

describe('DOCX renderer — AST v1 maturity test', () => {
  it('generates a non-empty .docx with the correct MIME type', async () => {
    const buf = await generateDocument({ format: 'docx', content: AST })

    expect(buf.length).toBeGreaterThan(0)
    expect(mimeForFormat('docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )

    const { docXml, media } = await reopenDocx(buf)

    expect(docXml).toContain('Architecture Maturity') // heading
    expect(docXml).toContain('The AST is now format-agnostic.') // paragraph
    expect(docXml).toContain('Decoupled') // list
    expect(docXml).toContain('Format') // table header
    expect(docXml).toContain('No renderer owns the document logic.') // quote
    expect(docXml).toContain('const ast = toAst(input)') // code
    expect(docXml).toContain('w:tbl') // table element
    expect(docXml).toContain('<w:br w:type="page"/>') // page break
    expect(media.length).toBeGreaterThan(0) // image embedded
  })
})
