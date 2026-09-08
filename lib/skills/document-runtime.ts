/**
 * Document runtime — real server-side execution of the document Anthropic
 * skills (pdf / docx / xlsx / pptx) using the already-installed libraries.
 *
 * This is the EXECUTION layer the Skill Router's prompt-injection cannot
 * provide on its own: it actually reads, creates, modifies and exports real
 * binary files, then validates them by reopening. The chatbot's `document`
 * tool (lib/tools/document.ts) calls into this module so generated files are
 * genuine artifacts, never invented text.
 *
 * Libraries (all already in package.json / node_modules):
 *   - docx        -> create .docx
 *   - exceljs     -> read / create / modify .xlsx
 *   - pptxgenjs   -> create .pptx
 *   - pdf-lib     -> create / export .pdf (+ best-effort text extraction)
 *   - jszip       -> read .docx / .pptx OOXML (transitive dep)
 *   - fflate      -> inflate FlateDecode PDF streams (transitive dep)
 */

import { TEMPLATES } from './document-templates'

export type DocumentFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'html'
  | 'markdown'

const MIME: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  markdown: 'text/markdown'
}

export function mimeForFormat(format: DocumentFormat): string {
  return MIME[format]
}

export function formatFromName(fileName: string): DocumentFormat | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx') || lower.endsWith('.dotx')) return 'docx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx'
  if (lower.endsWith('.pptx')) return 'pptx'
  return null
}

/** MIME type → document format lookup used by upload / attachment routing. */
export const MIME_TO_FORMAT: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/html': 'html',
  'text/markdown': 'markdown'
}

/** The MIME types the document skills can actually execute on. */
export const DOCUMENT_MIME_TYPES: string[] = Object.keys(MIME_TO_FORMAT)

export function formatFromMime(mime: string): DocumentFormat | null {
  return MIME_TO_FORMAT[mime.toLowerCase()] ?? null
}

/** Minimal shape of a chat message file attachment. */
export interface AttachmentLike {
  type?: string
  mimeType?: string
  filename?: string
  name?: string
}

/**
 * Collect the document skill slugs (pdf / docx / xlsx / pptx) for a set of
 * message attachments so the EXISTING Skill Router can activate the matching
 * skill even when the textual query has no trigger. Reuses the router — no
 * second router is created.
 */
export function extractAttachmentFormats(
  attachments: AttachmentLike[]
): string[] {
  const out = new Set<string>()
  for (const a of attachments) {
    const fmt =
      (a.mimeType && formatFromMime(a.mimeType)) ||
      (a.filename && formatFromName(a.filename)) ||
      (a.name && formatFromName(a.name)) ||
      null
    if (fmt) out.add(fmt)
  }
  return [...out]
}

export interface DocumentReadResult {
  format: DocumentFormat
  text: string
  pages?: number
  sheets?: number
  slides?: number
  /** Per-sheet / per-slide structured content when available. */
  structure?: unknown
  /** Set when extraction was best-effort / partial (caller must not invent). */
  partial?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export async function readDocument(
  format: DocumentFormat,
  buffer: Buffer
): Promise<DocumentReadResult> {
  switch (format) {
    case 'xlsx':
      return readXlsx(buffer)
    case 'docx':
      return readDocx(buffer)
    case 'pptx':
      return readPptx(buffer)
    case 'pdf':
      return readPdf(buffer)
    default:
      return { format, text: '', error: `Unsupported format: ${format}` }
  }
}

async function readXlsx(buffer: Buffer): Promise<DocumentReadResult> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as never)
  const sheets: Record<string, unknown> = {}
  let text = ''
  wb.eachSheet(ws => {
    const rows: string[] = []
    ws.eachRow((row, rowNum) => {
      const cells: string[] = []
      row.eachCell(cell => {
        cells.push(String(cell.value ?? ''))
      })
      const line = `R${rowNum}: ${cells.join(' | ')}`
      rows.push(line)
      text += line + '\n'
    })
    sheets[ws.name] = rows
  })
  return {
    format: 'xlsx',
    text: text.trim(),
    sheets: wb.worksheets.length,
    structure: sheets
  }
}

async function readDocx(buffer: Buffer): Promise<DocumentReadResult> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml)
    return { format: 'docx', text: '', error: 'word/document.xml missing' }
  const text = extractXmlText(docXml, /<w:t[^>]*>([\s\S]*?)<\/w:t>/g)
  return { format: 'docx', text: text.trim() }
}

async function readPptx(buffer: Buffer): Promise<DocumentReadResult> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort()
  const slides: string[] = []
  let text = ''
  for (const file of slideFiles) {
    const xml = await zip.file(file)?.async('string')
    if (!xml) continue
    const slideText = extractXmlText(xml, /<a:t[^>]*>([\s\S]*?)<\/a:t>/g)
    slides.push(slideText)
    text += `Slide ${slides.length}:\n${slideText}\n\n`
  }
  return { format: 'pptx', text: text.trim(), slides: slides.length }
}

async function readPdf(buffer: Buffer): Promise<DocumentReadResult> {
  try {
    // Use unpdf (pdf.js) for proper text extraction — it decodes font
    // encodings / CMaps that pdf-lib cannot, so real text PDFs are read
    // instead of returning empty strings.
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { totalPages, text } = await extractText(pdf, { mergePages: true })
    const clean = (text ?? '').trim()
    return {
      format: 'pdf',
      text: clean,
      pages: totalPages ?? 0,
      partial: clean.length === 0
    }
  } catch (e) {
    // Fallback to the best-effort pdf-lib extractor if unpdf is unavailable
    // or fails on this particular file.
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.load(new Uint8Array(buffer))
      const pages = pdf.getPages()
      let text = ''
      for (const page of pages) text += (await getPageText(page)) + '\n'
      const clean = text.trim()
      return {
        format: 'pdf',
        text: clean,
        pages: pages.length,
        partial: true,
        error: clean ? undefined : String(e)
      }
    } catch (e2) {
      return { format: 'pdf', text: '', error: String(e2) }
    }
  }
}

async function getPageText(page: import('pdf-lib').PDFPage): Promise<string> {
  try {
    // pdf-lib exposes the page node; pull raw content streams and decode
    // FlateDecode streams with fflate (best-effort text recovery).
    const node = (page as unknown as { node?: { Contents?: unknown } }).node
    const contents = node?.Contents
    if (!contents) return ''
    const streams = Array.isArray(contents) ? contents : [contents]
    const { inflateSync } = (await import('fflate')) as any
    let raw = ''
    for (const stream of streams) {
      const anyStream = stream as unknown as {
        contents?: Uint8Array
        dict?: Map<string, unknown>
      }
      let data = anyStream.contents
      const filter = anyStream.dict?.get?.('Filter')
      if (data && filter === 'FlateDecode') {
        try {
          data = inflateSync(new Uint8Array(data))
        } catch {
          /* leave as-is */
        }
      }
      if (data) raw += new TextDecoder().decode(data)
    }
    return extractPdfText(raw)
  } catch {
    return ''
  }
}

function extractPdfText(raw: string): string {
  const out: string[] = []
  const re = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out.push(m[1].replace(/\\([nrt])/g, ' ').replace(/\\(.)/g, '$1'))
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function extractXmlText(xml: string, tagRe: RegExp): string {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    out.push(decodeXml(m[1]))
  }
  return out.join('\n')
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export interface CreateDocxSpec {
  title?: string
  sections?: { heading?: string; paragraphs?: string[] }[]
  paragraphs?: string[]
}

export interface CreateXlsxSpec {
  sheets?: { name?: string; rows: (string | number)[][] }[]
}

export interface CreatePptxSpec {
  slides?: { title?: string; bullets?: string[]; notes?: string }[]
  title?: string
}

export interface CreatePdfSpec {
  title?: string
  paragraphs?: string[]
  [key: string]: unknown
}

export async function createDocument(
  format: DocumentFormat,
  spec: unknown
): Promise<Buffer> {
  // The model sometimes forwards the spec as a JSON string, a bare string or a
  // bare array instead of a structured object. Normalize it before dispatch so
  // every format (and the PDF path in particular) can read the content.
  const normalized = normalizeSpec(spec)
  switch (format) {
    case 'docx':
      return createDocx(normalized as CreateDocxSpec)
    case 'xlsx':
      return createXlsx(normalized as CreateXlsxSpec)
    case 'pptx':
      return createPptx(normalized as CreatePptxSpec)
    case 'pdf':
      return createPdf(normalized as CreatePdfSpec)
    default:
      throw new Error(`Cannot create format: ${format}`)
  }
}

/**
 * Accept whatever shape the model produced for `spec` and turn it into a plain
 * object the create functions can read:
 *   - a JSON string (parse it)
 *   - a bare string (treat as the document body)
 *   - a bare array (treat as a list of paragraphs/rows/slides)
 *   - an object (returned as-is)
 */
function normalizeSpec(spec: unknown): Record<string, unknown> {
  if (spec == null) return {}
  if (typeof spec === 'string') {
    const trimmed = spec.trim()
    if (!trimmed) return {}
    // Try to parse a JSON payload first; otherwise treat the whole string as
    // the document text so it is never silently dropped.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object')
          return parsed as Record<string, unknown>
      } catch {
        /* fall through to plain-text handling */
      }
    }
    return { content: trimmed }
  }
  if (Array.isArray(spec)) {
    return { paragraphs: spec }
  }
  if (typeof spec === 'object') return spec as Record<string, unknown>
  return { content: String(spec) }
}

async function createDocx(spec: CreateDocxSpec): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import(
    'docx'
  )
  const sections = spec.sections ?? [
    { paragraphs: spec.paragraphs ?? ['Document created with the docx skill.'] }
  ]
  const children: unknown[] = []
  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_1
        })
      )
    }
    for (const p of section.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(p)] }))
    }
  }
  const doc = new Document({
    sections: [{ children: children as never[] }]
  })
  return Buffer.from(await Packer.toBuffer(doc as never))
}

async function createXlsx(spec: CreateXlsxSpec): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const sheets = spec.sheets?.length
    ? spec.sheets
    : [{ name: 'Sheet1', rows: [['Column A', 'Column B']] }]
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name ?? 'Sheet1')
    for (const row of sheet.rows) {
      ws.addRow(row)
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

async function createPptx(spec: CreatePptxSpec): Promise<Buffer> {
  const PptxGen = (await import('pptxgenjs')).default
  const pptx = new PptxGen()
  const slides = spec.slides?.length
    ? spec.slides
    : [
        {
          title: spec.title ?? 'Presentation',
          bullets: ['Slide created with the pptx skill.']
        }
      ]
  for (const slide of slides) {
    const s = pptx.addSlide()
    if (slide.title) s.addText(slide.title, { fontSize: 28, bold: true })
    if (slide.bullets?.length)
      s.addText(
        slide.bullets.map(b => ({ text: b, options: { bullet: true } })),
        { fontSize: 18 }
      )
    if (slide.notes) s.addNotes(slide.notes)
  }
  const data = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(data as never)
}

/**
 * Minimum intent score before we route a document to the premium engine. Below
 * this we stay on the lightweight pdf-lib engine so plain notes/README never get
 * pushed to Chromium unnecessarily.
 */
const AUTO_THRESHOLD = 1.0

/**
 * Intent rules for automatic template selection. Each entry is
 * [term, template, weight]. Only templates present in the registry are valid
 * auto-targets. Weights let a clear intent outrank an ambiguous token — e.g.
 * "Rapport sur mon projet CV" scores report (1.2) above cv (1.0) and therefore
 * becomes a report, not a CV.
 */
const INTENTS: [string, string, number][] = [
  ['rapport', 'report', 1.2],
  ['report', 'report', 1.2],
  ['cv', 'cv', 1.0],
  ['curriculum', 'cv', 1.0],
  ['resume', 'resume', 1.0],
  ['portfolio', 'portfolio', 1.0],
  ['brochure', 'brochure', 1.0],
  ['magazine', 'magazine', 1.0],
  ['facture', 'invoice', 1.0],
  ['invoice', 'invoice', 1.0],
  ['certificat', 'certificate', 1.0],
  ['certificate', 'certificate', 1.0],
  ['proposition', 'proposal', 1.0],
  ['proposal', 'proposal', 1.0]
]

/**
 * Gather all human-readable text from a document spec so intent scoring can see
 * everything the model sent — not just `content`/`markdown`/`text`. Models often
 * hand back the body as `paragraphs` or `sections`, and we must still detect
 * design-doc keywords there (e.g. "facture" inside a paragraphs array) to route
 * the request to the premium engine.
 */
function collectDocText(spec: Record<string, unknown>): string {
  const parts: string[] = []
  const title = pickString(spec, ['title', 'heading', 'name', 'subject'])
  if (title) parts.push(title)
  for (const key of ['content', 'markdown', 'body', 'text']) {
    const v = spec[key]
    if (typeof v === 'string') parts.push(v)
  }
  if (Array.isArray(spec.paragraphs)) {
    for (const p of spec.paragraphs) if (typeof p === 'string') parts.push(p)
  }
  if (Array.isArray(spec.sections)) {
    for (const s of spec.sections as Array<Record<string, unknown>>) {
      if (typeof s.heading === 'string') parts.push(s.heading)
      else if (typeof s.title === 'string') parts.push(s.title)
      if (Array.isArray(s.paragraphs)) {
        for (const p of s.paragraphs) if (typeof p === 'string') parts.push(p)
      } else if (typeof s.content === 'string') parts.push(s.content)
    }
  }
  if (
    Array.isArray(spec.data) ||
    Array.isArray(spec.story) ||
    Array.isArray(spec.items)
  ) {
    const arr = (spec.data ?? spec.story ?? spec.items) as unknown[]
    for (const it of arr) {
      if (typeof it === 'string') parts.push(it)
      else if (it && typeof (it as Record<string, unknown>).text === 'string')
        parts.push((it as Record<string, unknown>).text as string)
    }
  }
  return parts.join(' ').toLowerCase()
}

function scoreIntent(
  spec: Record<string, unknown>
): { template: string; score: number } | null {
  const hay = collectDocText(spec)
  const scores: Record<string, number> = {}
  for (const [term, template, weight] of INTENTS) {
    if (hay.includes(term)) scores[template] = (scores[template] ?? 0) + weight
  }
  let best: string | null = null
  let bestScore = 0
  for (const [tpl, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s
      best = tpl
    }
  }
  return best ? { template: best, score: bestScore } : null
}

/** Normalize a requested template name to one that exists in the registry. */
function asTemplateName(value: unknown): string {
  return typeof value === 'string' &&
    value.trim() !== '' &&
    value.trim() in TEMPLATES
    ? value.trim()
    : 'default'
}

/**
 * Resolve which engine + template a PDF should use.
 *  - explicit `premium` / `template` overrides win
 *  - otherwise intent scoring picks a design template only when its score clears
 *    AUTO_THRESHOLD; below that we stay on the lightweight pdf-lib engine
 */
function resolvePdfPlan(spec: Record<string, unknown>): {
  premium: boolean
  template: string
} {
  if (spec.premium === true) {
    return { premium: true, template: asTemplateName(spec.template) }
  }
  if (spec.premium === false) {
    return { premium: false, template: 'default' }
  }
  const requested =
    typeof spec.template === 'string' ? spec.template.trim() : ''
  if (requested) {
    return { premium: true, template: asTemplateName(requested) }
  }
  const intent = scoreIntent(spec)
  // Explicit "premium" phrasing must force the premium engine even when no
  // template/intent keyword is present — otherwise a request like "generate a
  // premium PDF" silently falls through to the plain pdf-lib engine and the
  // user gets an unstyled document that contradicts the "premium" promise.
  const hay = collectDocText(spec)
  if (/\bpremium\b/.test(hay)) {
    return { premium: true, template: intent ? intent.template : 'default' }
  }
  if (intent && intent.score >= AUTO_THRESHOLD) {
    return { premium: true, template: intent.template }
  }
  return { premium: false, template: 'default' }
}

async function createPdf(spec: CreatePdfSpec): Promise<Buffer> {
  // Premium path: render Markdown as styled HTML via Playwright/Chromium for a
  // design-quality PDF. Falls back to the dependency-free engine if the flag is
  // off, Playwright is not installed, or rendering fails.
  const anySpec = spec as Record<string, unknown>
  const plan = resolvePdfPlan(anySpec)
  if (plan.premium) {
    const { createPremiumPdf, chromiumPremiumAvailable } = await import(
      './document-pdf-html'
    )
    // If a self-check (startup probe or a prior failed attempt) already proved
    // Chromium cannot launch here, skip the premium engine entirely and go
    // straight to the dependency-free pdf-lib renderer — this avoids re-paying
    // the full launch timeout on every premium document.
    if (chromiumPremiumAvailable() !== false) {
      try {
        return await createPremiumPdf({ ...anySpec, template: plan.template })
      } catch (e) {
        console.error('Premium PDF rendering failed, using built-in engine:', e)
      }
    }
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  // Embed a small font set so we can render bold / italic / monospace styles
  // instead of a single flat font.
  const fonts = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier)
  }
  // Whatever shape the model sent, normalize it to a single Markdown string and
  // render it as a real, richly-formatted document.
  const source = buildMarkdownSource(anySpec)
  const blocks = parseMarkdown(source)
  const writer = new PdfWriter(
    pdf,
    fonts,
    rgb as unknown as (r: number, g: number, b: number) => any
  )
  writer.renderAll(blocks)
  return Buffer.from(await pdf.save())
}

// ---------------------------------------------------------------------------
// PDF MARKDOWN RENDERER
// ---------------------------------------------------------------------------

const PAGE_W = 612
const PAGE_H = 792
const MARGIN_X = 56
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 56

/** A styled text fragment produced by the inline Markdown parser. */
export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

export type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'bullet'; items: Run[][] }
  | { type: 'ordered'; items: Run[][] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; runs: Run[] }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; rows: string[][] }

/**
 * Normalize whatever shape the model sent for `spec` into a single Markdown
 * string, preserving line breaks and indentation so code blocks / lists render
 * correctly. The model may pass the body as `markdown`, `content`, `body`,
 * `text`, a `paragraphs` array, `sections`, or a `data`/`story`/`items` array.
 */
export function buildMarkdownSource(spec: Record<string, unknown>): string {
  let md = ''
  if (typeof spec.markdown === 'string') md = spec.markdown
  else if (typeof spec.content === 'string') md = spec.content
  else if (typeof spec.body === 'string') md = spec.body
  else if (typeof spec.text === 'string') md = spec.text
  else if (Array.isArray(spec.sections)) {
    const parts: string[] = []
    for (const s of spec.sections as Array<Record<string, unknown>>) {
      if (typeof s.heading === 'string') parts.push(`## ${s.heading}`)
      else if (typeof s.title === 'string') parts.push(`## ${s.title}`)
      const paras =
        (s.paragraphs as unknown[]) ??
        (typeof s.content === 'string'
          ? [s.content]
          : Array.isArray(s.content)
            ? (s.content as unknown[])
            : [])
      for (const p of paras) if (typeof p === 'string') parts.push(p)
    }
    md = parts.join('\n\n')
  } else if (Array.isArray(spec.paragraphs)) {
    md = (spec.paragraphs as unknown[])
      .filter(p => typeof p === 'string')
      .join('\n\n')
  } else if (
    Array.isArray(spec.data) ||
    Array.isArray(spec.story) ||
    Array.isArray(spec.items)
  ) {
    const arr = (spec.data ?? spec.story ?? spec.items) as unknown[]
    md = arr
      .map(it =>
        typeof it === 'string'
          ? it
          : it && typeof (it as Record<string, unknown>).text === 'string'
            ? (it as Record<string, unknown>).text
            : ''
      )
      .filter(Boolean)
      .join('\n\n')
  }
  // If the content does not already open with a heading, promote `title`.
  if (md && !/^\s*#\s/m.test(md)) {
    const title = pickString(spec, ['title', 'heading', 'name', 'subject'])
    if (title) md = `# ${title}\n\n` + md
  }
  return md
}

/** Pick the first non-empty string value among the given keys. */
function pickString(
  spec: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = spec[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/**
 * Make text safe for pdf-lib's WinAnsi (Latin-1) standard fonts: fold the
 * usual Unicode punctuation to ASCII and strip anything that has no glyph so it
 * does not render as blank space. Accented Latin letters (é, à, ç, …) survive.
 */
function sanitizePdfText(input: string): string {
  return input
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒]/g, '-')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7eÀ-ÿ]/g, '')
}

/**
 * Parse inline Markdown (`**bold**`, `*italic*`, `_italic_`, `` `code` `` and
 * `[text](url)`) into styled runs. Nesting works one level deep (e.g. bold
 * containing an italic span) via recursive calls.
 */
function parseInline(input: string): Run[] {
  if (input == null) return []
  const runs: Run[] = []
  const re =
    /(\*\*([^*]+?)\*\*)|(__([^_]+?)__)|(\*([^*]+?)\*)|(_([^_]+?)_)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m.index > last) runs.push({ text: input.slice(last, m.index) })
    if (m[1] != null)
      runs.push(...applyStyle(parseInline(m[2]), { bold: true }))
    else if (m[3] != null)
      runs.push(...applyStyle(parseInline(m[4]), { bold: true }))
    else if (m[5] != null)
      runs.push(...applyStyle(parseInline(m[6]), { italic: true }))
    else if (m[7] != null)
      runs.push(...applyStyle(parseInline(m[8]), { italic: true }))
    else if (m[9] != null)
      runs.push(...applyStyle(parseInline(m[10]), { code: true }))
    else if (m[11] != null)
      runs.push(...applyStyle(parseInline(m[12]), { link: m[13] }))
    last = re.lastIndex
  }
  if (last < input.length) runs.push({ text: input.slice(last) })
  return runs
}

function applyStyle(inner: Run[], style: Partial<Run>): Run[] {
  if (inner.length === 0) return []
  return inner.map(r => ({ ...r, ...style }))
}

/** Parse a Markdown document (string) into a list of renderable blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  const isSpecial = (l: string) =>
    /^(#{1,6})\s+/.test(l) ||
    /^\s*```/.test(l) ||
    /^\s*>\s?/.test(l) ||
    /^\s*([-*+]\s+)/.test(l) ||
    /^\s*\d+[.)]\s+/.test(l) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) ||
    /^\s*\|.*\|\s*$/.test(l)

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++
      blocks.push({ type: 'code', lang, code: buf.join('\n') })
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({
        type: 'heading',
        level: h[1].length,
        runs: parseInline(h[2])
      })
      i++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      const buf = [q[1]]
      i++
      let mm: RegExpExecArray | null
      while (i < lines.length && (mm = /^>\s?(.*)$/.exec(lines[i]))) {
        buf.push(mm[1])
        i++
      }
      blocks.push({ type: 'quote', runs: parseInline(buf.join(' ')) })
      continue
    }

    // Table: a | row | followed by a | --- | separator row.
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      const items: Run[][] = []
      while (i < lines.length && /^(\s*)[-*+]\s+(.*)$/.exec(lines[i])) {
        const mm = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i])!
        items.push(parseInline(mm[2]))
        i++
      }
      blocks.push({ type: 'bullet', items })
      continue
    }

    const ord = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
    if (ord) {
      const items: Run[][] = []
      while (i < lines.length && /^(\s*)(\d+)[.)]\s+(.*)$/.exec(lines[i])) {
        const mm = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(lines[i])!
        items.push(parseInline(mm[3]))
        i++
      }
      blocks.push({ type: 'ordered', items })
      continue
    }

    // Paragraph: consecutive non-blank, non-special lines.
    const buf = [line]
    i++
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !isSpecial(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', runs: parseInline(buf.join(' ')) })
  }
  return blocks
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim())
}

/**
 * Stateful PDF layout engine. Draws blocks top-to-bottom, paginating
 * automatically and honoring headings, bold/italic/code spans, lists,
 * blockquotes, code blocks, rules, tables and clickable hyperlinks.
 */
class PdfWriter {
  private pdf: any
  private fonts: any
  private rgb: (r: number, g: number, b: number) => any
  private page: any
  private y: number

  constructor(
    pdf: any,
    fonts: any,
    rgb: (r: number, g: number, b: number) => any
  ) {
    this.pdf = pdf
    this.fonts = fonts
    this.rgb = rgb
    this.page = pdf.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN_TOP
  }

  private get contentWidth(): number {
    return PAGE_W - MARGIN_X * 2
  }

  private newPage(): void {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN_TOP
  }

  private ensure(h: number): void {
    if (this.y - h < MARGIN_BOTTOM) this.newPage()
  }

  private fontFor(run: Run): any {
    if (run.code) return this.fonts.mono
    if (run.bold && run.italic) return this.fonts.boldItalic
    if (run.bold) return this.fonts.bold
    if (run.italic) return this.fonts.italic
    return this.fonts.normal
  }

  renderAll(blocks: Block[]): void {
    for (const b of blocks) this.render(b)
  }

  private render(b: Block): void {
    switch (b.type) {
      case 'heading':
        return this.renderHeading(b)
      case 'paragraph':
        return this.renderParagraph(b)
      case 'bullet':
        return this.renderList(b.items, false)
      case 'ordered':
        return this.renderList(b.items, true)
      case 'code':
        return this.renderCode(b)
      case 'quote':
        return this.renderQuote(b)
      case 'hr':
        return this.renderHr()
      case 'table':
        return this.renderTable(b)
    }
  }

  private renderHeading(b: Extract<Block, { type: 'heading' }>): void {
    const level = Math.min(Math.max(b.level, 1), 6)
    const size = [22, 18, 15, 13, 12, 11][level - 1]
    const gapBefore = level === 1 ? 22 : 14
    this.ensure(size * 1.6 + 12)
    this.y -= gapBefore
    const runs = b.runs.map(r => ({ ...r, bold: true }))
    this.drawRuns(runs, {
      size,
      lineHeight: size * 1.3,
      color: this.rgb(0.07, 0.07, 0.1)
    })
    if (level <= 2) {
      this.page.drawLine({
        start: { x: MARGIN_X, y: this.y + size * 0.5 },
        end: { x: MARGIN_X + this.contentWidth, y: this.y + size * 0.5 },
        thickness: 0.75,
        color: this.rgb(0.8, 0.8, 0.82)
      })
      this.y -= 8
    } else {
      this.y -= 4
    }
  }

  private renderParagraph(b: Extract<Block, { type: 'paragraph' }>): void {
    this.ensure(16)
    this.drawRuns(b.runs, {
      size: 11,
      lineHeight: 16,
      color: this.rgb(0.12, 0.12, 0.15)
    })
    this.y -= 6
  }

  private renderList(items: Run[][], ordered: boolean): void {
    this.ensure(16)
    items.forEach((item, i) => {
      this.ensure(16)
      const prefix = ordered ? `${i + 1}.  ` : '•  '
      const prefixW = this.fonts.bold.widthOfTextAtSize(prefix, 11)
      const runs = [
        { text: prefix, bold: true, italic: false, code: false },
        ...item
      ]
      this.drawRuns(runs, {
        size: 11,
        lineHeight: 16,
        indent: 2,
        hanging: prefixW + 4,
        color: this.rgb(0.12, 0.12, 0.15)
      })
      this.y -= 3
    })
    this.y -= 4
  }

  private renderQuote(b: Extract<Block, { type: 'quote' }>): void {
    this.ensure(16)
    const top = this.y
    this.drawRuns(b.runs, {
      size: 11,
      lineHeight: 16,
      indent: 16,
      color: this.rgb(0.35, 0.35, 0.38),
      italic: true
    })
    this.page.drawLine({
      start: { x: MARGIN_X + 4, y: this.y + 4 },
      end: { x: MARGIN_X + 4, y: top },
      thickness: 1.5,
      color: this.rgb(0.7, 0.7, 0.72)
    })
    this.y -= 6
  }

  private renderCode(b: Extract<Block, { type: 'code' }>): void {
    const size = 9.5
    const lh = size * 1.45
    const padX = 10
    const padY = 8
    const lines = b.code.replace(/\n+$/, '').split('\n')
    const wrapped: string[] = []
    for (const line of lines) {
      wrapped.push(
        ...this.wrapMono(
          line.length ? line : ' ',
          this.contentWidth - padX * 2,
          size
        )
      )
    }
    const blockH = wrapped.length * lh + padY * 2
    this.ensure(blockH + 8)
    const top = this.y
    this.page.drawRectangle({
      x: MARGIN_X,
      y: top - blockH,
      width: this.contentWidth,
      height: blockH,
      color: this.rgb(0.95, 0.96, 0.98),
      borderWidth: 0
    })
    let yy = top - padY - size
    for (const wl of wrapped) {
      this.page.drawText(wl, {
        x: MARGIN_X + padX,
        y: yy,
        size,
        font: this.fonts.mono,
        color: this.rgb(0.1, 0.1, 0.12)
      })
      yy -= lh
    }
    this.y = top - blockH - 8
  }

  private renderHr(): void {
    this.ensure(16)
    this.y -= 6
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y },
      end: { x: MARGIN_X + this.contentWidth, y: this.y },
      thickness: 1,
      color: this.rgb(0.8, 0.8, 0.8)
    })
    this.y -= 12
  }

  private renderTable(b: Extract<Block, { type: 'table' }>): void {
    const all = [b.header, ...b.rows].map(r =>
      (r || []).map(c => String(c ?? ''))
    )
    const colCount = Math.max(1, ...all.map(r => r.length))
    const grid = all.map(r =>
      Array.from({ length: colCount }, (_, c) => r[c] ?? '')
    )
    const weights: number[] = []
    for (let c = 0; c < colCount; c++) {
      let max = 0
      for (const row of grid) max = Math.max(max, (row[c] || '').length)
      weights.push(max || 1)
    }
    const total = weights.reduce((a, x) => a + x, 0) || 1
    const gap = 6
    const avail = this.contentWidth - gap * (colCount + 1)
    const colW: number[] = weights.map(w => Math.max(36, (w / total) * avail))
    const size = 10
    const cellLH = size * 1.35
    const padY = 5

    const drawRow = (cells: string[], isHeader: boolean) => {
      const cellLines: string[][] = cells.map((cell, c) =>
        this.wrapText2(
          sanitizePdfText(cell),
          colW[c] - gap,
          isHeader ? this.fonts.bold : this.fonts.normal,
          size
        )
      )
      const rowH =
        Math.max(1, ...cellLines.map(l => l.length)) * cellLH + padY * 2
      this.ensure(rowH)
      const top = this.y
      this.page.drawRectangle({
        x: MARGIN_X,
        y: top - rowH,
        width: this.contentWidth,
        height: rowH,
        color: isHeader ? this.rgb(0.93, 0.94, 0.96) : this.rgb(1, 1, 1),
        borderWidth: 0
      })
      let x = MARGIN_X + gap
      cellLines.forEach((lines, c) => {
        let yy = top - padY - size
        for (const ln of lines) {
          this.page.drawText(ln, {
            x: x + gap / 2,
            y: yy,
            size,
            font: isHeader ? this.fonts.bold : this.fonts.normal,
            color: this.rgb(0.12, 0.12, 0.15)
          })
          yy -= cellLH
        }
        this.page.drawLine({
          start: { x: x + colW[c], y: top },
          end: { x: x + colW[c], y: top - rowH },
          thickness: 0.5,
          color: this.rgb(0.85, 0.85, 0.88)
        })
        x += colW[c] + gap
      })
      this.page.drawLine({
        start: { x: MARGIN_X, y: top - rowH },
        end: { x: MARGIN_X + this.contentWidth, y: top - rowH },
        thickness: 0.5,
        color: this.rgb(0.85, 0.85, 0.88)
      })
      this.y = top - rowH
    }

    drawRow(grid[0], true)
    for (let r = 1; r < grid.length; r++) drawRow(grid[r], false)
    this.y -= 8
  }

  /**
   * Draw a sequence of inline runs with word-wrap. `hanging` indents every line
   * after the first (used for list items / blockquotes). Long words that exceed
   * the available width are hard-split so nothing overflows the page.
   */
  private drawRuns(
    runs: Run[],
    opts: {
      size?: number
      lineHeight?: number
      indent?: number
      hanging?: number
      color?: any
      italic?: boolean
    }
  ): void {
    const size = opts.size ?? 11
    const lineHeight = opts.lineHeight ?? size * 1.45
    const indent = opts.indent ?? 0
    const hanging = opts.hanging ?? 0
    const color = opts.color ?? this.rgb(0.12, 0.12, 0.15)
    const maxWidth = this.contentWidth - indent

    const tokens: { text: string; run: Run; noSpace: boolean }[] = []
    for (let r of runs) {
      if (opts.italic) r = { ...r, italic: true }
      const text = sanitizePdfText(r.text)
      if (!text) continue
      const words = text.split(/\s+/).filter(Boolean)
      for (const word of words) {
        const w = this.fontFor(r).widthOfTextAtSize(word, size)
        if (w > maxWidth) {
          const chunks = this.splitWord(word, r, maxWidth, size)
          chunks.forEach((c, ci) =>
            tokens.push({ text: c, run: r, noSpace: ci > 0 })
          )
        } else {
          tokens.push({ text: word, run: r, noSpace: false })
        }
      }
    }
    if (tokens.length === 0) return

    let line: { text: string; run: Run }[] = []
    let lineWidth = 0
    let firstLine = true

    const flush = () => {
      let x = MARGIN_X + indent + (firstLine ? 0 : hanging)
      let first = true
      for (const t of line) {
        const f = this.fontFor(t.run)
        if (!first) x += f.widthOfTextAtSize(' ', size)
        const w = f.widthOfTextAtSize(t.text, size)
        this.page.drawText(t.text, {
          x,
          y: this.y,
          size,
          font: f,
          color: t.run.link ? this.rgb(0.1, 0.32, 0.78) : color
        })
        if (t.run.link) this.addLink(x, this.y, w, size, t.run.link)
        x += w
        first = false
      }
      this.y -= lineHeight
      firstLine = false
      line = []
      lineWidth = 0
    }

    for (const t of tokens) {
      const f = this.fontFor(t.run)
      const w = f.widthOfTextAtSize(t.text, size)
      if (line.length === 0) {
        line.push(t)
        lineWidth = w
      } else {
        const sep = f.widthOfTextAtSize(' ', size)
        if (t.noSpace) {
          if (lineWidth + w > maxWidth) {
            flush()
            line.push(t)
            lineWidth = w
          } else {
            line.push(t)
            lineWidth += w
          }
        } else {
          if (lineWidth + sep + w > maxWidth) {
            flush()
            line.push(t)
            lineWidth = w
          } else {
            line.push(t)
            lineWidth += sep + w
          }
        }
      }
    }
    if (line.length) flush()
  }

  private splitWord(
    word: string,
    run: Run,
    maxWidth: number,
    size: number
  ): string[] {
    const f = this.fontFor(run)
    const out: string[] = []
    let cur = ''
    for (const ch of word) {
      if (f.widthOfTextAtSize(cur + ch, size) <= maxWidth) cur += ch
      else {
        if (cur) out.push(cur)
        cur = ch
      }
    }
    if (cur) out.push(cur)
    return out.length ? out : [word]
  }

  private wrapMono(line: string, maxWidth: number, size: number): string[] {
    const text = sanitizePdfText(line)
    if (!text) return ['']
    const out: string[] = []
    let cur = ''
    for (const ch of text) {
      if (this.fonts.mono.widthOfTextAtSize(cur + ch, size) <= maxWidth)
        cur += ch
      else {
        out.push(cur)
        cur = ch
      }
    }
    if (cur) out.push(cur)
    return out
  }

  private wrapText2(
    text: string,
    maxWidth: number,
    font: any,
    size: number
  ): string[] {
    const t = sanitizePdfText(text)
    if (!t) return ['']
    const words = t.split(/\s+/).filter(Boolean)
    const out: string[] = []
    let cur = ''
    for (const word of words) {
      const w = font.widthOfTextAtSize(word, size)
      if (w > maxWidth) {
        if (cur) {
          out.push(cur)
          cur = ''
        }
        let piece = ''
        for (const ch of word) {
          if (font.widthOfTextAtSize(piece + ch, size) <= maxWidth) piece += ch
          else {
            if (piece) out.push(piece)
            piece = ch
          }
        }
        if (piece) cur = piece
        continue
      }
      const trial = cur ? cur + ' ' + word : word
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) cur = trial
      else {
        if (cur) out.push(cur)
        cur = word
      }
    }
    if (cur) out.push(cur)
    return out.length ? out : ['']
  }

  /** Add a clickable hyperlink annotation (best-effort). */
  private addLink(
    x: number,
    yBaseline: number,
    w: number,
    size: number,
    url: string
  ): void {
    try {
      const ctx = this.pdf.context
      const annot = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [x, yBaseline - 2, x + w, yBaseline + size - 2],
          Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: ctx.obj(url) }
        })
      )
      this.page.node.addAnnot(annot)
    } catch {
      /* annotations are optional */
    }
  }
}

// ---------------------------------------------------------------------------
// MODIFY
// ---------------------------------------------------------------------------

export interface ModifyXlsxOptions {
  type: 'addColumn'
  sheet?: string
  columnName: string
  /** Optional formula template, e.g. "A{n}+B{n}". Use {n} for row number. */
  formula?: string
}

export async function modifyDocument(
  format: DocumentFormat,
  buffer: Buffer,
  modifications: unknown
): Promise<Buffer> {
  if (format !== 'xlsx') {
    throw new Error(`Modification not supported for ${format} in this build`)
  }
  return modifyXlsx(buffer, modifications as ModifyXlsxOptions)
}

async function modifyXlsx(
  buffer: Buffer,
  opts: ModifyXlsxOptions
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as never)
  const ws = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.worksheets[0]
  if (!ws) throw new Error('Worksheet not found')
  const col = ws.columnCount + 1
  ws.getCell(1, col).value = opts.columnName
  const rowCount = ws.rowCount
  for (let r = 2; r <= rowCount; r++) {
    if (opts.formula) {
      ws.getCell(r, col).value = {
        formula: opts.formula.replace(/\{n\}/g, String(r)),
        result: 0
      }
    } else {
      ws.getCell(r, col).value = ''
    }
  }
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

// ---------------------------------------------------------------------------
// VALIDATE (reopen to prove the file is real and well-formed)
// ---------------------------------------------------------------------------

export async function validateDocument(
  format: DocumentFormat,
  buffer: Buffer
): Promise<{ ok: boolean; error?: string; meta?: Record<string, number> }> {
  try {
    switch (format) {
      case 'xlsx': {
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buffer as never)
        return { ok: true, meta: { sheets: wb.worksheets.length } }
      }
      case 'docx': {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(buffer)
        const ok = Boolean(zip.file('word/document.xml'))
        return { ok, meta: { files: Object.keys(zip.files).length } }
      }
      case 'pptx': {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(buffer)
        const slideCount = Object.keys(zip.files).filter(f =>
          /^ppt\/slides\/slide\d+\.xml$/.test(f)
        ).length
        return { ok: slideCount > 0, meta: { slides: slideCount } }
      }
      case 'pdf': {
        const { PDFDocument } = await import('pdf-lib')
        const pdf = await PDFDocument.load(new Uint8Array(buffer))
        return { ok: true, meta: { pages: pdf.getPages().length } }
      }
      case 'html':
      case 'markdown':
        // Text formats: valid when non-empty.
        return { ok: buffer.length > 0, meta: { bytes: buffer.length } }
      default:
        return { ok: false, error: `Unsupported: ${format}` }
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
