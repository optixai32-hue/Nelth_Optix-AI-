import { GET } from './app/api/documents/[id]/route.ts'
import { generateDocument } from './lib/skills/document-engine.ts'
import { mimeForFormat } from './lib/skills/document-runtime.ts'
import { resolveStoredDocument,storeDocument } from './lib/skills/document-store.ts'

for (const fmt of ['pdf','docx','xlsx','pptx']) {
  const buf = await generateDocument({ format: fmt, content: { title: 'Report', paragraphs: ['Hello world from '+fmt] } })
  const name = 'report.'+fmt
  const stored = await storeDocument(buf, name, mimeForFormat(fmt))
  console.log(fmt, 'stored id=', stored.id, 'file=', stored.fileName)
  const found = await resolveStoredDocument(stored.id)
  const res = await GET(new Request('http://localhost/api/documents/'+stored.id), { params: Promise.resolve({ id: stored.id }) })
  console.log('   resolve=', found?'OK':'NULL', 'GET=', res.status, 'ct=', res.headers.get('Content-Type'), 'disp=', res.headers.get('Content-Disposition'))
}
console.log('DONE')
