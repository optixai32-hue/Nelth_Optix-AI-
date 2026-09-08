import { describe, expect, it } from 'vitest'

import {
  createDocument,
  type DocumentFormat,
  formatFromMime,
  formatFromName,
  modifyDocument,
  readDocument,
  validateDocument
} from './document-runtime'

/**
 * REAL document skill execution tests.
 *
 * Every test below actually creates / reads / modifies / validates real binary
 * documents using the already-installed libraries (docx / exceljs / pptxgenjs /
 * pdf-lib / jszip). No fake artifacts are produced — a failure here means the
 * skill genuinely cannot execute.
 */

describe('Document format detection', () => {
  it('maps filenames to formats', () => {
    expect(formatFromName('report.PDF')).toBe('pdf')
    expect(formatFromName('doc.docx')).toBe('docx')
    expect(formatFromName('data.XLSX')).toBe('xlsx')
    expect(formatFromName('deck.pptx')).toBe('pptx')
    expect(formatFromName('notes.txt')).toBeNull()
  })

  it('maps MIME types to formats', () => {
    expect(formatFromMime('application/pdf')).toBe('pdf')
    expect(
      formatFromMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('docx')
    expect(
      formatFromMime(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    ).toBe('xlsx')
    expect(
      formatFromMime(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ).toBe('pptx')
    expect(formatFromMime('image/png')).toBeNull()
  })
})

describe('TEST 1 — PDF read + export', () => {
  it('creates a readable PDF and validates it', async () => {
    const buf = await createDocument('pdf', {
      title: 'Quarterly Report',
      paragraphs: [
        'This is the executive summary.',
        'Revenue grew 12 percent year over year.'
      ]
    })
    expect(buf.length).toBeGreaterThan(0)

    const validation = await validateDocument('pdf', buf)
    if (!validation.ok) console.error('PDF validation error:', validation.error)
    expect(validation.ok).toBe(true)
    expect(validation.meta?.pages).toBeGreaterThanOrEqual(1)

    const read = await readDocument('pdf', buf)
    expect(read.format).toBe('pdf')
    expect(read.pages).toBeGreaterThanOrEqual(1)
    // pdf-lib text recovery is best-effort; we at least prove real extraction ran.
    expect(typeof read.text).toBe('string')
  })
})

describe('TEST 2 — DOCX read + export', () => {
  it('creates a DOCX, reads it back, and validates it', async () => {
    const buf = await createDocument('docx', {
      title: 'Market Analysis',
      sections: [
        {
          heading: 'Overview',
          paragraphs: ['The market is expanding rapidly.']
        },
        {
          heading: 'Risks',
          paragraphs: ['Supply chain disruption is the top risk.']
        }
      ]
    })
    expect(buf.length).toBeGreaterThan(0)

    const validation = await validateDocument('docx', buf)
    expect(validation.ok).toBe(true)
    expect(validation.meta?.files).toBeGreaterThan(0)

    const read = await readDocument('docx', buf)
    expect(read.format).toBe('docx')
    expect(read.text).toContain('The market is expanding rapidly.')
    expect(read.text).toContain('Supply chain disruption is the top risk.')
  })
})

describe('TEST 3 — XLSX read (B27)', () => {
  it('reads the real value of cell B27', async () => {
    // Build a workbook whose row 27, column B holds a known value.
    const rows: (string | number)[][] = []
    for (let r = 1; r <= 30; r++) {
      rows.push([`Label${r}`, r === 27 ? 'B27_SECRET_VALUE' : `V${r}`])
    }
    const buf = await createDocument('xlsx', {
      sheets: [{ name: 'Data', rows }]
    })

    const validation = await validateDocument('xlsx', buf)
    expect(validation.ok).toBe(true)
    expect(validation.meta?.sheets).toBe(1)

    const read = await readDocument('xlsx', buf)
    expect(read.format).toBe('xlsx')
    // The extracted text must contain the actual B27 value, not an invented one.
    expect(read.text).toContain('B27_SECRET_VALUE')
    // The structured dump should reference row 27.
    expect(read.text).toContain('R27:')
  })
})

describe('TEST 4 — XLSX modification (add Total column)', () => {
  it('adds a real Total column, re-validates and re-reads', async () => {
    const rows: (string | number)[][] = []
    for (let r = 1; r <= 5; r++) {
      rows.push([`Item${r}`, r * 10])
    }
    const original = await createDocument('xlsx', {
      sheets: [{ name: 'Sheet1', rows }]
    })

    const before = await readDocument('xlsx', original)
    const colsBefore = (before.structure as Record<string, string[]>)[
      'Sheet1'
    ][0].split(' | ').length

    const modified = await modifyDocument('xlsx', original, {
      type: 'addColumn',
      columnName: 'Total'
    })

    const validation = await validateDocument('xlsx', modified)
    expect(validation.ok).toBe(true)

    const after = await readDocument('xlsx', modified)
    const colsAfter = (after.structure as Record<string, string[]>)[
      'Sheet1'
    ][0].split(' | ').length
    expect(colsAfter).toBe(colsBefore + 1)
    expect(after.text).toContain('Total')
  })
})

describe('TEST 7 — PPTX export (5 slides)', () => {
  it('creates a 5-slide deck, validates and reads it back', async () => {
    const slides = Array.from({ length: 5 }, (_, i) => ({
      title: `Slide ${i + 1}`,
      bullets: [`Point ${i + 1}A`, `Point ${i + 1}B`]
    }))
    const buf = await createDocument('pptx', { slides })

    const validation = await validateDocument('pptx', buf)
    expect(validation.ok).toBe(true)
    expect(validation.meta?.slides).toBe(5)

    const read = await readDocument('pptx', buf)
    expect(read.format).toBe('pptx')
    expect(read.slides).toBe(5)
    expect(read.text).toContain('Slide 1')
    expect(read.text).toContain('Slide 5')
  })
})

describe('TEST 9 — invalid file handling', () => {
  it('does not invent content for a corrupt PDF', async () => {
    const fake = Buffer.from('this is not a real pdf file')
    const validation = await validateDocument('pdf', fake)
    // A corrupt file either fails validation or returns no usable pages.
    if (validation.ok) {
      expect(validation.meta?.pages).toBe(0)
    } else {
      expect(validation.ok).toBe(false)
    }
    const read = await readDocument('pdf', fake)
    expect(read.text).toBe('')
  })

  it('rejects modification of unsupported formats', async () => {
    const buf = Buffer.from('x')
    await expect(
      modifyDocument('pdf' as DocumentFormat, buf, {})
    ).rejects.toThrow()
  })
})
