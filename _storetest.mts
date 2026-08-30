import { resolveStoredDocument,storeDocument } from './lib/skills/document-store.ts'
for (const [name, mime] of [['a.pdf','application/pdf'],['b.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['c.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['d.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation']]) {
  const buf = Buffer.from('hello-'+name)
  const stored = await storeDocument(buf, name, mime)
  const found = await resolveStoredDocument(stored.id)
  console.log(name, '->', stored.id, 'resolved:', found ? 'OK ('+found.meta.fileName+','+found.meta.mimeType+')' : 'NOT FOUND')
}
