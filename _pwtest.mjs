import { chromium } from 'playwright'
const log = (...a) => {
  console.log('[t]', ...a)
}
log('before launch')
try {
  const b = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  })
  log('launched')
  const p = await b.newPage()
  await p.setContent('<h1>Hi</h1>')
  const buf = await p.pdf({ format: 'A4' })
  log('pdf bytes', buf.length)
  await b.close()
} catch (e) {
  log('ERROR', e && e.message)
}
