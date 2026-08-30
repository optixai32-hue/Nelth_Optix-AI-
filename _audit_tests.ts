/**
 * Functional audit tests for the Python→TS skill ports.
 * Run:  bun _audit_tests.ts
 * (Outputs go to ./_audit_out; cleaned up at the end.)
 */
import { promises as fs } from 'fs'
import { existsSync, mkdtempSync, readFileSync,rmSync } from 'fs'
import os from 'os'
import path from 'path'

import { buildDocx } from './skills-main/skills-main/skills/docx/scripts/docx'
import { createConnection } from './skills-main/skills-main/skills/mcp-builder/scripts/connections'
import { fillPdf } from './skills-main/skills-main/skills/pdf/scripts/fill_pdf'
import { buildPptx } from './skills-main/skills-main/skills/pptx/scripts/pptx'
import { packageSkill } from './skills-main/skills-main/skills/skill-creator/scripts/package_skill'
import { validateSkill } from './skills-main/skills-main/skills/skill-creator/scripts/quick_validate'
import { Frame } from './skills-main/skills-main/skills/slack-gif-creator/core/frame'
import { GIFBuilder } from './skills-main/skills-main/skills/slack-gif-creator/core/gif_builder'
import { withServer } from './skills-main/skills-main/skills/webapp-testing/scripts/with_server'
import { recalc } from './skills-main/skills-main/skills/xlsx/scripts/recalc'

const OUT = mkdtempSync(path.join(os.tmpdir(), 'audit-'))
let pass = 0
let fail = 0
function check(name: string, ok: boolean, info = ''): void {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${info}`)
  }
}

async function main(): Promise<void> {
  // ---------- skill-creator: quick_validate ----------
  console.log('\n[skill-creator] quick_validate')
  const validDir = path.join(OUT, 'valid-skill')
  await fs.mkdir(validDir, { recursive: true })
  await fs.writeFile(
    path.join(validDir, 'SKILL.md'),
    '---\nname: my-skill\ndescription: Does something useful for the user.\n---\n# My Skill\nBody text.\n'
  )
  const v1 = await validateSkill(validDir)
  check('valid skill passes', v1.valid, v1.message)

  const badDir = path.join(OUT, 'bad-skill')
  await fs.mkdir(badDir, { recursive: true })
  await fs.writeFile(
    path.join(badDir, 'SKILL.md'),
    '---\nname: Bad_Name\ndescription: has angle <bracket>\n---\nbody\n'
  )
  const v2 = await validateSkill(badDir)
  check('bad name+angle bracket fails', !v2.valid, v2.message)

  // ---------- skill-creator: package_skill ----------
  console.log('\n[skill-creator] package_skill')
  const zipPath = await packageSkill(validDir, OUT)
  check('packageSkill returns a path', !!zipPath)
  if (zipPath && existsSync(zipPath)) {
    const buf = readFileSync(zipPath)
    const hasPk = buf[0] === 0x50 && buf[1] === 0x4b // 'PK'
    const hasSkillMd = buf.includes(Buffer.from('SKILL.md'))
    check('zip has PK magic', hasPk)
    check('zip contains SKILL.md entry', hasSkillMd)
  }
  const nullPkg = await packageSkill(badDir, OUT)
  check('packageSkill rejects invalid skill (returns null)', nullPkg === null)

  // ---------- slack-gif-creator: full GIF ----------
  console.log('\n[slack-gif-creator] gif_builder')
  const b = new GIFBuilder(120, 120, 10)
  for (let i = 0; i < 5; i++) {
    const f = Frame.blank(120, 120, [i * 10, 20, 200 - i * 10])
    f.drawCircle(60, 60, 30 + i * 5, [255, 80, 80], [0, 0, 0], 2)
    b.addFrame(f)
  }
  const gifInfo = await b.save(path.join(OUT, 'anim.gif'), { numColors: 32 })
  const gifBuf = readFileSync(path.join(OUT, 'anim.gif'))
  check('GIF89a header', gifBuf.toString('ascii', 0, 6) === 'GIF89a', gifBuf.toString('ascii', 0, 6))
  const w = gifBuf[6] | (gifBuf[7] << 8)
  const h = gifBuf[8] | (gifBuf[9] << 8)
  check('width from LSD', w === 120, `w=${w}`)
  check('height from LSD', h === 120, `h=${h}`)
  check('trailer 0x3B', gifBuf[gifBuf.length - 1] === 0x3b)
  check('frame count reported', gifInfo.frameCount === 5, `fc=${gifInfo.frameCount}`)
  // Frame primitive roundtrip
  const fr = Frame.blank(10, 10, [0, 0, 0])
  fr.setPixel(3, 3, [9, 8, 7])
  const px = fr.getPixel(3, 3)
  check('Frame.setPixel/getPixel', px[0] === 9 && px[1] === 8 && px[2] === 7)
  // deduplicate
  const b2 = new GIFBuilder(50, 50, 10)
  for (let i = 0; i < 4; i++) b2.addFrame(Frame.blank(50, 50, [10, 10, 10]))
  const removed = b2.deduplicateFrames()
  check('deduplicate removes identical frames', removed === 3, `removed=${removed}`)

  // ---------- webapp-testing: with_server orchestration ----------
  console.log('\n[webapp-testing] with_server')
  const code = await withServer(
    [{ cmd: `node -e "const h=require('http');h.createServer((q,r)=>r.end('hi')).listen(${8799})`, port: 8799 }],
    8000,
    ['node', '-e', "process.stdout.write('CMD_OK')"]
  )
  check('withServer ran command and returned 0', code === 0, `code=${code}`)

  // ---------- docx / pptx / xlsx / pdf (real file generation) ----------
  console.log('\n[docx] buildDocx')
  await buildDocx(path.join(OUT, 'doc.docx'), { title: 'T', paragraphs: ['Hello'] })
  const docBuf = readFileSync(path.join(OUT, 'doc.docx'))
  check('docx is a ZIP (PK)', docBuf[0] === 0x50 && docBuf[1] === 0x4b)

  console.log('\n[pptx] buildPptx')
  await buildPptx(path.join(OUT, 'deck.pptx'), [{ title: 'Slide', bullets: ['a', 'b'] }])
  const pptxBuf = readFileSync(path.join(OUT, 'deck.pptx'))
  check('pptx is a ZIP (PK)', pptxBuf[0] === 0x50 && pptxBuf[1] === 0x4b)

  console.log('\n[xlsx] recalc')
  const exceljs = await import('exceljs')
  const ExcelJS = (exceljs as any).default ?? exceljs
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('S')
  ws.getCell('A1').value = 2
  ws.getCell('A2').value = 3
  ws.getCell('A3').value = { formula: 'A1+A2' }
  await wb.xlsx.writeFile(path.join(OUT, 'in.xlsx'))
  await recalc(path.join(OUT, 'in.xlsx'), path.join(OUT, 'out.xlsx'))
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.readFile(path.join(OUT, 'out.xlsx'))
  const val = wb2.getWorksheet('S').getCell('A3').value
  check('xlsx formula recomputed to 5', val === 5, `val=${JSON.stringify(val)}`)

  console.log('\n[pdf] fillPdf')
  const pdfLib = await import('pdf-lib')
  const { PDFDocument } = pdfLib as any
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([200, 200])
  const form = pdf.getForm()
  form.createTextField('Name')
  const pdfBytes = await pdf.save()
  const formPath = path.join(OUT, 'form.pdf')
  await fs.writeFile(formPath, pdfBytes)
  await fillPdf(formPath, path.join(OUT, 'filled.pdf'), { Name: 'Alice' })
  const filled = await PDFDocument.load(readFileSync(path.join(OUT, 'filled.pdf')))
  const f2 = filled.getForm()
  check('pdf field filled with Alice', f2.getTextField('Name').getText() === 'Alice')

  // ---------- mcp-builder: real stdio server round-trip ----------
  console.log('\n[mcp-builder] connections (stdio round-trip)')
  try {
    const serverFile = path.join(OUT, 'mcpserver.mjs')
    await fs.writeFile(
      serverFile,
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const s = new McpServer({ name: 't', version: '1' });
s.tool('ping', 'returns pong', async () => ({ content: [{ type: 'text', text: 'pong' }] }));
await s.connect(new StdioServerTransport());
`
    )
    const conn = createConnection('stdio', { command: 'bun', args: [serverFile] })
    await conn.connect()
    const tools = await conn.listTools()
    const hasPing = (tools as any).tools?.some((t: any) => t.name === 'ping')
    check('MCP server exposes ping tool', !!hasPing)
    const res = await conn.callTool('ping', {})
    const text = JSON.stringify(res)
    check('MCP tool call returns pong', text.includes('pong'), text)
    await conn.close()
    check('MCP connection closes', true)
  } catch (e) {
    check('MCP round-trip', false, String(e).slice(0, 120))
  }

  console.log(`\n================ AUDIT TESTS: ${pass} PASS / ${fail} FAIL ================`)
  rmSync(OUT, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('TEST HARNESS ERROR:', e)
  process.exit(2)
})
