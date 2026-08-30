import { describe, expect, it } from 'vitest'

import type { DocumentAST } from './document-ast/types'
import { generateDocument } from './document-engine'

/**
 * Maturity test for the SVG renderer. Runs the SAME Document AST used by the
 * PDF / DOCX / PPTX / XLSX maturity tests and verifies the AST v1 contract also
 * survives a free 2D vector format — proving the semantic core scales to N
 * independent output representations.
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
        ['SVG', 'OK']
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
    { type: 'paragraph', text: 'Second zone after the page break.' }
  ]
}

describe('SVG renderer — AST v1 maturity test', () => {
  it('generates a non-empty, valid <svg> from the shared AST', async () => {
    const buf = await generateDocument({ format: 'svg', content: AST })

    expect(buf.length).toBeGreaterThan(0)

    const svg = buf.toString('utf-8')

    // Valid SVG root with explicit dimensions / viewBox.
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toMatch(/viewBox="0 0 800 \d+/)
    expect(svg.trim().endsWith('</svg>')).toBe(true)

    // Every block type is represented.
    expect(svg).toContain('Architecture Maturity') // heading
    expect(svg).toContain('The AST is now format-agnostic.') // paragraph
    expect(svg).toContain('• Decoupled') // bulleted list
    expect(svg).toContain('1. First') // numbered list
    expect(svg).toContain('Format') // table header
    expect(svg).toContain('No renderer owns the document logic.') // quote
    expect(svg).toContain('const ast = toAst(input)') // code
    expect(svg).toContain('<image') // image
    expect(svg).toContain('class="page-break"') // pageBreak separator
    expect(svg).toContain('Second zone after the page break.') // content after break
  })
})
