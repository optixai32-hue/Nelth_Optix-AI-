/**
 * Premium PDF renderer.
 *
 * Takes the same Markdown `spec` the built-in engine consumes and produces a
 * high-fidelity, design-quality PDF by rendering a template-driven styled HTML
 * document with a headless Chromium (Playwright) and printing to PDF. This is
 * the "Premium docs" branch of the Document Renderer:
 *
 *   AI → Document JSON / AST → Markdown ─┬─ pdf-lib   (simple docs)
 *                                       └─ HTML/CSS → Playwright (premium)
 *
 * It depends on the `playwright` package + a Chromium binary. If either is
 * missing or rendering fails, callers fall back to the dependency-free pdf-lib
 * engine so generation never breaks.
 *
 * The premium path is template-driven: pass `spec.template` (e.g. 'cv',
 * 'invoice', 'report', 'certificate', 'proposal', 'magazine', 'brochure',
 * 'portfolio', 'resume', 'minimal', 'default') and an optional `spec.accent`
 * (brand hex color) to get a genuinely designed document.
 */

import { buildCvModel, renderCvHtml } from './document-cv'
import { buildInvoiceModel, renderInvoiceHtml } from './document-invoice'
import { type Block, buildMarkdownSource, parseMarkdown, type Run } from './document-runtime'
import { getTemplate, TEMPLATES } from './document-templates'

/**
 * One-time Chromium availability cache.
 *
 * Some environments (sandboxes, locked-down CI, serverless containers) ship
 * the Chromium binary but cannot actually launch it — the launch then hangs
 * until the render timeout (~20s) before we fall back to pdf-lib. To avoid
 * paying that cost on *every* premium document, we probe Chromium once and
 * remember the outcome for the whole process:
 *   - `true`  → premium rendering is allowed
 *   - `false` → premium renderer is permanently disabled, fall back instantly
 *   - `null`  → not yet probed (first premium call will probe, or the startup
 *               self-check in `instrumentation.ts` pre-warms it)
 */
let _premiumAvailable: boolean | null = null
let _premiumCheck: Promise<boolean> | null = null

const SELFCHECK_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage'
]

/**
 * Whether we are running inside a serverless/FaaS environment (Vercel, AWS
 * Lambda, …). These environments ship no system Chromium, so we must use a
 * serverless-compatible build (e.g. @sparticuz/chromium) instead of the
 * locally-installed Playwright browser.
 */
function isServerless(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME != null ||
    process.env.IS_SERVERLESS === '1' ||
    process.env.LAMBDA_TASK_ROOT != null
  )
}

/**
 * Resolve the Chromium launch options for the current environment.
 *
 * - Local / Docker: use the Playwright-bundled Chromium with the standard
 *   sandbox-disabling args.
 * - Serverless (Vercel, Lambda): use @sparticuz/chromium, which ships a
 *   serverless-compatible Chromium binary. The import is dynamic so the
 *   dependency is only required when actually needed (and its absence locally
 *   does not break the pdf-lib fallback).
 *
 * Returns `{ args, executablePath? }`. `executablePath` is omitted when the
 * default Playwright browser should be used.
 */
async function resolveChromiumLaunchOptions(): Promise<{
  args: string[]
  executablePath?: string
}> {
  if (!isServerless()) {
    return { args: SELFCHECK_ARGS }
  }
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default
    // Keep the serverless binary lean (no GPU/graphics subsystems).
    sparticuz.setGraphicsMode = false
    const executablePath = await sparticuz.executablePath()
    return { args: sparticuz.args, executablePath }
  } catch {
    // If the serverless Chromium cannot be resolved, fall back to the default
    // Playwright launch (which then fails gracefully → pdf-lib).
    return { args: SELFCHECK_ARGS }
  }
}

/** Launch Chromium with environment-appropriate options. */
async function launchChromium(): Promise<import('playwright').Browser> {
  const { chromium } = await import('playwright')
  return chromium.launch(await resolveChromiumLaunchOptions())
}

/** Synchronous read of the cached self-check result (`null` = not yet probed). */
export function chromiumPremiumAvailable(): boolean | null {
  return _premiumAvailable
}

/**
 * Probe Chromium once (and cache). Safe to call repeatedly; the real launch
 * only happens on the first call. Pass `force: true` to re-probe (e.g. after a
 * config change). Resolves `false` instead of throwing so callers can fall
 * back gracefully.
 */
export function checkChromiumPremium(opts: { timeoutMs?: number; force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && _premiumAvailable !== null) return Promise.resolve(_premiumAvailable)
  if (!opts.force && _premiumCheck) return _premiumCheck
  // 15s locally: generous enough that a slow-but-working cold start still
  // passes, while a truly broken environment (launch that hangs forever) is
  // still caught and disables the premium renderer. Serverless cold starts
  // must also decompress/resolve the @sparticuz/chromium binary, so they get a
  // much larger budget.
  const baseTimeout = opts.timeoutMs ?? 15000
  const timeoutMs = isServerless() ? Math.max(baseTimeout, 60000) : baseTimeout
  _premiumCheck = (async () => {
    try {
      const browser = await withTimeout(launchChromium(), timeoutMs, 'Chromium self-check')
      await browser.close()
      _premiumAvailable = true
    } catch {
      _premiumAvailable = false
    }
    _premiumCheck = null
    return _premiumAvailable
  })()
  return _premiumCheck
}

/** Reject if `promise` does not settle within `ms`; used to guard Chromium. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      v => {
        clearTimeout(t)
        resolve(v)
      },
      e => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Render a Markdown `spec` to a premium PDF buffer via Playwright. */
export async function createPremiumPdf(spec: Record<string, unknown>): Promise<Buffer> {
  // If a self-check (startup or first attempt) already proved Chromium cannot
  // launch here, fail fast so the caller falls back to pdf-lib immediately
  // instead of burning the full launch timeout again.
  if (_premiumAvailable === false) {
    throw new Error('Chromium premium renderer disabled (self-check failed)')
  }
  const markdown = buildMarkdownSource(spec)
  const requested = typeof spec.template === 'string' && spec.template.trim() ? spec.template.trim() : 'default'
  const templateName = requested in TEMPLATES ? requested : 'default'
  // Only accept a strict #RGB or #RRGGBB hex — never inject an arbitrary value
  // into CSS (prevents injection / broken styles). Anything else → default.
  const accent =
    typeof spec.accent === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(spec.accent)
      ? spec.accent
      : '#2563eb'

  // Template Selector — the Premium Document Engine routes each document type to
  // its own dedicated, purpose-built renderer instead of a one-size-fits-all
  // Markdown transcription. Each renderer owns its layout, components, design
  // system and pagination rules; the shared AST/markdown source is only the
  // input. Everything else falls back to the generic styled-Markdown path.
  const DEDICATED: Record<string, (spec: Record<string, unknown>, accent: string) => string> = {
    invoice: (s, a) => renderInvoiceHtml(buildInvoiceModel(s), a),
    cv: (s, a) => renderCvHtml(buildCvModel(s), a),
    resume: (s, a) => renderCvHtml(buildCvModel(s), a)
  }
  const html =
    templateName in DEDICATED
      ? DEDICATED[templateName](spec, accent)
      : markdownToHtml(parseMarkdown(markdown), templateName, accent)

  // Guard the launch with a timeout: if Chromium cannot start in this
  // environment the call must fail fast and fall back to the pdf-lib engine
  // instead of hanging the whole document request forever.
  let browser
  try {
    browser = await withTimeout(launchChromium(), 20000, 'Chromium launch')
  } catch (e) {
    // Remember that Chromium is unusable so later premium requests skip
    // straight to the fallback instead of re-attempting the doomed launch.
    _premiumAvailable = false
    _premiumCheck = null
    throw e
  }
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' }
    })
    return Buffer.from(bytes)
  } finally {
    await browser.close()
  }
}

export interface HtmlToPdfOptions {
  /** Paper format passed to Playwright (e.g. 'A4', 'Letter'). */
  format?: string
  /** Page margins; omit for a borderless print of the HTML's own layout. */
  margin?: { top?: string; bottom?: string; left?: string; right?: string }
}

/**
 * Render ALREADY-STYLED HTML to a real PDF via headless Chromium.
 *
 * Unlike {@link createPremiumPdf} this does NOT markdown-template the input — it
 * prints exactly the HTML it is given, so bespoke layouts (e.g. a designer CV
 * with grids and skill bars) survive intact. If the input is a fragment it is
 * wrapped in a minimal HTML skeleton; a full document is used as-is.
 *
 * Throws if Playwright/Chromium is unavailable — callers should surface a
 * helpful message rather than silently degrading to a fake PDF.
 */
export async function htmlToPdf(rawHtml: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
  const trimmed = rawHtml.trim()
  const isDocument = /^<!doctype\s+/i.test(trimmed) || /<html[\s>]/i.test(trimmed)
  const html = isDocument
    ? trimmed
    : `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>html,body{margin:0;padding:0}</style></head><body>${trimmed}</body></html>`

  let browser
  try {
    browser = await withTimeout(launchChromium(), 20000, 'Chromium launch')
  } catch (e) {
    _premiumAvailable = false
    _premiumCheck = null
    throw e
  }
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    const bytes = await page.pdf({
      format: opts.format ?? 'A4',
      printBackground: true,
      margin: opts.margin ?? { top: '0', bottom: '0', left: '0', right: '0' }
    })
    return Buffer.from(bytes)
  } finally {
    await browser.close()
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function runsToHtml(runs: Run[]): string {
  return runs
    .map(r => {
      let t = esc(r.text)
      if (r.code) {
        t = `<code>${t}</code>`
      } else {
        if (r.bold) t = `<strong>${t}</strong>`
        if (r.italic) t = `<em>${t}</em>`
      }
      if (r.link) t = `<a href="${esc(r.link)}">${t}</a>`
      return t
    })
    .join('')
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 1), 6)
      return `<h${level}>${runsToHtml(b.runs)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${runsToHtml(b.runs)}</p>`
    case 'bullet':
      return `<ul>${b.items.map(i => `<li>${runsToHtml(i)}</li>`).join('')}</ul>`
    case 'ordered':
      return `<ol>${b.items.map(i => `<li>${runsToHtml(i)}</li>`).join('')}</ol>`
    case 'code':
      return `<pre><code>${esc(b.code)}</code></pre>`
    case 'quote':
      return `<blockquote>${runsToHtml(b.runs)}</blockquote>`
    case 'hr':
      return '<hr />'
    case 'table': {
      const header = b.header.map(c => `<th>${esc(c)}</th>`).join('')
      const rows = b.rows
        .map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')
      return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
    }
  }
}

/** Build a complete, styled HTML document from parsed Markdown blocks. */
function markdownToHtml(blocks: Block[], templateName: string, accent: string): string {
  const def = getTemplate(templateName)
  const body = blocks.map(blockToHtml).join('\n')
  const inner = def.wrap ? def.wrap(body, accent) : `<main class="tpl-${templateName}">${body}</main>`
  const css = def.css(accent)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Document</title>
<style>
:root { --accent: ${accent}; }
${css}
</style>
</head>
<body>
${inner}
</body>
</html>`
}
