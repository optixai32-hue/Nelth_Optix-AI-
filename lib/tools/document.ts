import { headers } from 'next/headers'

import { tool } from 'ai'
import { z } from 'zod'

import { generateDocument } from '@/lib/skills/document-engine'
import {
  type DocumentFormat,
  formatFromName,
  mimeForFormat,
  modifyDocument,
  readDocument,
  validateDocument
} from '@/lib/skills/document-runtime'
import { storeDocument } from '@/lib/skills/document-store'

const FORMATS = ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'markdown'] as const

/**
 * Real document execution tool. Guided by the activated document skill's SKILL.md,
 * the model calls this to actually READ / CREATE / MODIFY / EXPORT files. Every
 * output is a genuine binary stored on the server and returned as a downloadable
 * artifact — never an invented file.
 */
export const documentTool = tool({
  description:
    'Execute real document operations for Word (.docx), Excel (.xlsx), PowerPoint (.pptx) and PDF files: read/extract text, create a new file, modify an existing file, or export content to a file. Returns extracted text for reads, or a downloadable artifact (id + URL + fileName + mimeType + downloadMarkdown) for create/modify/export. For read/modify of an uploaded file, pass either the base64 content (fileContentBase64) or its URL (fileUrl). When presenting a generated/modified file to the user, output the exact `downloadMarkdown` value as a clickable markdown link — never prepend extra slashes or rewrite the URL.\n\nIMPORTANT for create/export — you MUST put the actual document content into `spec`, otherwise the generated file will be blank:\n  - PDF:   spec = { "title": "My report", "content": "# Heading\\n\\nA **bold** paragraph with a [link](https://example.com)..." }  - the body is rendered as RICH MARKDOWN (headings, **bold**, *italic*, `code`, lists, > quotes, tables and ```code blocks``` are all supported). Prefer passing the full markdown under "content" or "markdown"; you may also use "paragraphs": ["line 1", "line 2"]. The engine is chosen automatically: design docs (CV, portfolio, brochure, invoice, presentation, magazine, …) use the PREMIUM HTML/CSS path via Playwright; plain notes/README stay on the lightweight pdf-lib engine. Force premium with "premium": true, pick a layout with "template" ("default" | "cv" | "report" | "minimal") and brand it with "accent": "#RGB" or "#RRGGBB" only (other values are ignored). The premium path falls back to pdf-lib automatically if a browser is unavailable. Unknown template names fall back to "default"; only the templates listed above are valid. Premium rendering requires Chromium at runtime — install it once with `playwright install chromium`.\n  - DOCX:  spec = { "sections": [{ "heading": "Section 1", "paragraphs": ["...", "..."] }] } or { "paragraphs": ["...", "..."] }\n  - XLSX:  spec = { "sheets": [{ "name": "Sheet1", "rows": [["Header A", "Header B"], ["row1a", "row1b"]] }] }\n  - PPTX:  spec = { "slides": [{ "title": "Slide 1", "bullets": ["point 1", "point 2"] }] }\nAlways write the real user-facing content from your answer into these fields; do not leave them empty.',
  inputSchema: z.object({
    operation: z
      .enum(['read', 'create', 'modify', 'export'])
      .describe('What to do with the document.'),
    format: z
      .enum(FORMATS)
      .describe('Target document format (pdf, docx, xlsx, pptx).'),
    fileName: z
      .string()
      .optional()
      .describe('File name to use for the produced/referenced artifact, e.g. "report.docx".'),
    fileContentBase64: z
      .string()
      .optional()
      .describe('Base64 of the source file, required for read/modify of an uploaded file.'),
    fileUrl: z
      .string()
      .optional()
      .describe('URL of the source file (e.g. the signed upload URL from an attachment). Used to fetch the bytes when fileContentBase64 is not supplied.'),
    spec: z
      .record(z.string(), z.any())
      .optional()
      .describe('Structured content for create/export (docx sections, xlsx sheets, pptx slides, pdf paragraphs/markdown).'),
    premium: z
      .boolean()
      .optional()
      .describe('PDF only — set true to produce a premium, design-quality PDF rendered from Markdown via HTML/CSS (Playwright). Falls back to the standard engine if unavailable.'),
    template: z
      .string()
      .optional()
      .describe("PDF only — premium layout template: 'default' | 'cv' | 'report' | 'minimal'. Any value selects the premium engine."),
    accent: z
      .string()
      .optional()
      .describe('PDF only — premium brand color as a hex string, e.g. "#2563eb".'),
    modifications: z
      .record(z.string(), z.any())
      .optional()
      .describe('Modification description for modify (e.g. add a column to xlsx).')
  }),
  execute: async ({ operation, format, fileName, fileContentBase64, fileUrl, spec, modifications, premium, template, accent }) => {
    try {
      const fmt = format as DocumentFormat

      if (operation === 'read') {
        const buffer = await resolveSourceBuffer(fileContentBase64, fileUrl)
        if (!buffer) {
          return {
            success: false,
            error: 'read requires fileContentBase64 or fileUrl of the source file.'
          }
        }
        const result = await readDocument(fmt, buffer)
        return {
          success: true,
          format: fmt,
          text: result.text,
          pages: result.pages,
          sheets: result.sheets,
          slides: result.slides,
          partial: result.partial ?? false,
          error: result.error
        }
      }

      if (operation === 'create' || operation === 'export') {
        const mergedSpec: Record<string, unknown> = { ...(spec ?? {}) }
        if (premium) mergedSpec.premium = true
        if (template) mergedSpec.template = template
        if (accent) mergedSpec.accent = accent
        const buffer = await generateDocument({
          format: fmt,
          content: mergedSpec,
          premium,
          template,
          accent
        })
        const validation = await validateDocument(fmt, buffer)
        if (!validation.ok) {
          return { success: false, error: `Generated file failed validation: ${validation.error}` }
        }
        const name = fileName || defaultName(fmt)
        const stored = await storeDocument(buffer, name, mimeForFormat(fmt))
        // Permanent cloud URL when available (survives serverless instances);
        // otherwise the instance-local download route.
        const downloadUrl =
          stored.publicUrl ?? `/api/documents/${stored.id}`
        return {
          success: true,
          format: fmt,
          artifact: {
            id: stored.id,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.size,
            downloadUrl,
            downloadMarkdown: `[${stored.fileName}](${downloadUrl})`
          },
          validation: validation.meta
        }
      }

      // modify
      const src = await resolveSourceBuffer(fileContentBase64, fileUrl)
      if (!src) {
        return {
          success: false,
          error: 'modify requires fileContentBase64 or fileUrl of the source file.'
        }
      }
      const out = await modifyDocument(fmt, src, modifications ?? {})
      const validation = await validateDocument(fmt, out)
      if (!validation.ok) {
        return { success: false, error: `Modified file failed validation: ${validation.error}` }
      }
      const name = fileName || defaultName(fmt)
      const stored = await storeDocument(out, name, mimeForFormat(fmt))
      return {
        success: true,
        format: fmt,
        artifact: {
          id: stored.id,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          size: stored.size,
          downloadUrl:
            stored.publicUrl ?? `/api/documents/${stored.id}`,
          downloadMarkdown: `[${stored.fileName}](${stored.publicUrl ?? `/api/documents/${stored.id}`})`
        },
        validation: validation.meta
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }
})

function defaultName(format: DocumentFormat): string {
  return `document.${format}`
}

/**
 * Resolve the source file bytes for read/modify. Prefers an explicit base64
 * payload; otherwise fetches the file from a URL (the signed upload URL carried
 * by a chat attachment). Returns null when neither is available.
 *
 * Local filesystem uploads expose a path-relative URL (/api/local-file?key=...).
 * The model sometimes forwards that relative URL, so we resolve it against the
 * incoming request's host to build an absolute URL the server can fetch.
 */
async function resolveSourceBuffer(
  fileContentBase64?: string,
  fileUrl?: string
): Promise<Buffer | null> {
  if (fileContentBase64) {
    return Buffer.from(fileContentBase64, 'base64')
  }
  if (fileUrl) {
    const abs = await toAbsoluteUrl(fileUrl)
    const res = await fetch(abs)
    if (!res.ok) {
      throw new Error(`Failed to fetch source file from ${abs}: ${res.status}`)
    }
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }
  return null
}

/**
 * Turn a relative upload URL into an absolute one using the current request's
 * host. Falls back to the original URL if the request headers are unavailable.
 */
async function toAbsoluteUrl(url: string): Promise<string> {
  if (/^https?:\/\//i.test(url)) return url
  try {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') || 'http'
    const host = h.get('host') || 'localhost:3000'
    const path = url.startsWith('/') ? url : `/${url}`
    return `${proto}://${host}${path}`
  } catch {
    return url
  }
}

export { formatFromName }
