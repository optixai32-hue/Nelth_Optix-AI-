import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { DocumentAST } from './document-ast/types'
import { generateDocument } from './document-engine'
import { mimeForFormat } from './document-runtime'

/**
 * Maturity test for the PPTX renderer. Runs the SAME Document AST used by the
 * PDF / HTML / Markdown / DOCX maturity tests and verifies the AST v1 contract
 * also survives a spatial format (the first real stretch of the contract). A
 * failure here would mean the linear AST needs extending before SVG.
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
        ['PPTX', 'OK']
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
    { type: 'paragraph', text: 'Second slide after the page break.' }
  ]
}

async function reopenPptx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort()
  const slides = await Promise.all(
    slideFiles.map(async f => (await zip.file(f)?.async('string')) ?? '')
  )
  const media = Object.keys(zip.files).filter(f => /^ppt\/media\//.test(f))
  return { slides, media }
}

describe('PPTX renderer — AST v1 maturity test', () => {
  it('generates a non-empty .pptx with the correct MIME type', async () => {
    const buf = await generateDocument({ format: 'pptx', content: AST })

    expect(buf.length).toBeGreaterThan(0)
    expect(mimeForFormat('pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )

    const { slides, media } = await reopenPptx(buf)
    const docXml = slides.join('\n')

    expect(slides.length).toBeGreaterThanOrEqual(2) // pageBreak created a 2nd slide
    expect(docXml).toContain('Architecture Maturity') // heading
    expect(docXml).toContain('The AST is now format-agnostic.') // paragraph
    expect(docXml).toContain('Decoupled') // list
    expect(docXml).toContain('Format') // table header
    expect(docXml).toContain('No renderer owns the document logic.') // quote
    expect(docXml).toContain('const ast = toAst(input)') // code
    expect(docXml).toContain('Second slide after the page break.') // content after break
    expect(media.length).toBeGreaterThan(0) // image embedded
  })
})
