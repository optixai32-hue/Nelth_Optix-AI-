import type { DocumentAST, DocumentBlock } from '../../document-ast/types'
import type { RendererCapabilities } from '../../document-capabilities'

export interface RenderOptions {
  premium?: boolean
  template?: string
  accent?: string
}

/** HTML is a superset sink: it can represent every AST v1 block. */
export const capabilities: RendererCapabilities = {
  supportsHeadings: true,
  supportsParagraphs: true,
  supportsLists: true,
  supportsTables: true,
  supportsQuotes: true,
  supportsCode: true,
  supportsImages: true,
  supportsPageBreak: true
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * HTML renderer (AST → HTML). Pure transformation: it receives a DocumentAST
 * and emits a semantic, styled HTML document. It never decides document
 * structure — only `AST → target format`.
 */
export async function renderHtml(
  ast: DocumentAST,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const accent =
    typeof opts.accent === 'string' &&
    /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(opts.accent)
      ? opts.accent
      : '#2563eb'
  const title = ast.metadata?.title ?? 'Document'
  const lang = ast.metadata?.language ?? 'fr'
  const body = ast.blocks.map(blockToHtml).join('\n')

  const html = `<!doctype html>
<html lang="${escAttr(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escHtml(title)}</title>
<style>
:root { --accent: ${accent}; }
* { box-sizing: border-box; }
body { margin: 0; color: #1a1a1e; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; }
article { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; color: #0b0b0f; margin: 1.6em 0 0.6em; font-weight: 700; }
h1 { font-size: 2.2em; letter-spacing: -0.02em; border-bottom: 2px solid var(--accent); padding-bottom: 0.3em; }
h2 { font-size: 1.6em; border-bottom: 1px solid #e4e4ea; padding-bottom: 0.25em; }
h3 { font-size: 1.3em; }
p { margin: 0.9em 0; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
strong { font-weight: 700; } em { font-style: italic; }
ul, ol { margin: 0.9em 0; padding-left: 1.6em; }
li { margin: 0.35em 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: #f4f4f7; padding: 0.15em 0.4em; border-radius: 5px; color: #b3205f; }
pre { background: #0d1117; color: #e6edf3; padding: 16px 18px; border-radius: 10px; overflow-x: auto; margin: 1.1em 0; }
pre code { background: transparent; color: inherit; padding: 0; }
blockquote { margin: 1.1em 0; padding: 0.5em 1.1em; border-left: 4px solid var(--accent); background: color-mix(in srgb, var(--accent) 6%, #fff); color: #4a4a55; border-radius: 0 8px 8px 0; }
blockquote p { margin: 0.3em 0; }
hr { border: none; border-top: 1px solid #e4e4ea; margin: 1.8em 0; }
table { border-collapse: collapse; width: 100%; margin: 1.1em 0; font-size: 0.95em; }
th, td { border: 1px solid #e4e4ea; padding: 9px 11px; text-align: left; }
thead th { background: #f4f4f7; font-weight: 700; }
tbody tr:nth-child(even) { background: #fafafa; }
img { max-width: 100%; border-radius: 8px; }
</style>
</head>
<body>
<article>
${body}
</article>
</body>
</html>`
  return Buffer.from(html, 'utf-8')
}

function blockToHtml(b: DocumentBlock): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 1), 6)
      return `<h${level}>${escHtml(b.text)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${escHtml(b.text)}</p>`
    case 'list':
      if (b.ordered) {
        return `<ol>${b.items.map(i => `<li>${escHtml(i)}</li>`).join('')}</ol>`
      }
      return `<ul>${b.items.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>`
    case 'table': {
      const head = `<thead><tr>${b.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`
      const rows = b.rows
        .map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`)
        .join('')
      return `<table>${head}<tbody>${rows}</tbody></table>`
    }
    case 'quote':
      return `<blockquote><p>${escHtml(b.text)}</p></blockquote>`
    case 'code':
      return `<pre><code>${escHtml(b.code)}</code></pre>`
    case 'image':
      return `<img src="${escAttr(b.url)}" alt="${escAttr(b.alt ?? '')}" />`
    case 'pageBreak':
      return '<hr />'
  }
}
