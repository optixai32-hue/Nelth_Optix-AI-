import { readFileSync, writeFileSync } from 'fs'

import { htmlToPdf } from '../lib/skills/document-pdf-html'

const [,, htmlPath, outPath] = process.argv
if (!htmlPath || !outPath) {
  console.error('Usage: bun scripts/html-to-pdf.ts <input.html> <output.pdf>')
  process.exit(1)
}

const html = readFileSync(htmlPath, 'utf-8')
const buf = await htmlToPdf(html)
writeFileSync(outPath, buf)
console.log(`Wrote ${outPath}: ${buf.length} bytes`)
