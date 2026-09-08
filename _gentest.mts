try {
  const { generateDocument } = await import('./lib/skills/document-engine.ts')
  for (const fmt of ['pdf', 'docx', 'xlsx', 'pptx']) {
    try {
      const buf = await generateDocument({
        format: fmt,
        content: { title: 't', paragraphs: ['hello world'] }
      })
      console.log(fmt, 'OK bytes=', buf.length)
    } catch (e) {
      console.log(fmt, 'THREW:', String(e).slice(0, 200))
    }
  }
} catch (e) {
  console.log('IMPORT THREW:', String(e).slice(0, 300))
}
