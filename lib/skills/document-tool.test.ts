import { describe, expect, it } from 'vitest'

import { documentTool } from '@/lib/tools/document'

import { createDocument } from './document-runtime'

/**
 * REAL end-to-end through the chatbot's document tool. The tool is the same one
 * wired into the research agent, so these assertions prove the skill actually
 * produces downloadable artifacts (not invented text).
 */

async function runTool(args: Record<string, unknown>) {
  const fn = documentTool.execute
  if (!fn) throw new Error('documentTool.execute is undefined')
  return fn(args as never, {} as never)
}

describe('TEST 5/6/7/8 — document tool create + artifact', () => {
  it('creates a real DOCX and returns a downloadable artifact', async () => {
    const result = (await runTool({
      operation: 'create',
      format: 'docx',
      fileName: 'analysis.docx',
      spec: {
        sections: [{ heading: 'Summary', paragraphs: ['Real content here.'] }]
      }
    })) as any

    expect(result.success).toBe(true)
    expect(result.artifact).toBeTruthy()
    expect(result.artifact.fileName).toBe('analysis.docx')
    expect(result.artifact.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(result.artifact.downloadUrl).toMatch(/^\/api\/documents\/\w+$/)
    expect(result.artifact.size).toBeGreaterThan(0)
    expect(result.validation).toBeTruthy()
  })

  it('creates a PDF, XLSX and PPTX with valid artifacts', async () => {
    for (const [format, fileName, mime] of [
      ['pdf', 'export.pdf', 'application/pdf'],
      [
        'xlsx',
        'data.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ],
      [
        'pptx',
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ]
    ] as const) {
      const result = (await runTool({
        operation: 'create',
        format,
        fileName,
        spec:
          format === 'pptx'
            ? { slides: [{ title: 'A', bullets: ['b'] }] }
            : { paragraphs: ['hello'] }
      })) as any

      expect(result.success).toBe(true)
      expect(result.artifact.mimeType).toBe(mime)
      expect(result.artifact.downloadUrl).toMatch(/^\/api\/documents\/\w+$/)
    }
  })

  it('reads a REAL uploaded file and returns its actual content', async () => {
    const buf = await createDocument('docx', {
      sections: [{ heading: 'H', paragraphs: ['UniqueMarkerText123'] }]
    })
    const base64 = buf.toString('base64')

    const result = (await runTool({
      operation: 'read',
      format: 'docx',
      fileContentBase64: base64
    })) as any

    expect(result.success).toBe(true)
    expect(result.text).toContain('UniqueMarkerText123')
  })

  it('does NOT invent content when the source file is missing', async () => {
    const result = (await runTool({
      operation: 'read',
      format: 'docx'
    })) as any

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/fileContentBase64|fileUrl/)
  })

  it('returns an error (no fake artifact) when validation fails', async () => {
    // Patch createDocument path is not needed: feed a clearly invalid spec that
    // still builds but we instead test the invalid-file guard via modify.
    const result = (await runTool({
      operation: 'modify',
      format: 'xlsx',
      fileContentBase64: Buffer.from('not an xlsx').toString('base64')
    })) as any

    expect(result.success).toBe(false)
  })
})
