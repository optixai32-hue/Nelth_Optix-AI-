const fs = require('fs')
const d = JSON.parse(fs.readFileSync('instances.json', 'utf8'))
const inst = d.instances
const urls = Object.keys(inst)
const good = urls
  .filter(u => u.startsWith('https://'))
  .filter(u => inst[u]?.http?.status_code === 200)
  .filter(u => !u.includes('.onion'))
// Prefer ones that look stable / popular; just take a cap of 18
  .slice(0, 18)
console.log('picked', good.length)
console.log(JSON.stringify(good, null, 0))
