const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const res = await fetch('https://lite.duckduckgo.com/lite/', {
  method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html', Referer: 'https://duckduckgo.com/' },
  body: new URLSearchParams({ q: 'best laptops 2026', kl: 'wt-wt' }).toString(),
  signal: AbortSignal.timeout(8000)
})
const html = await res.text()
require('fs').writeFileSync('_lite.html', html)
console.log('saved len', html.length, 'status', res.status)
console.log('has result-link:', /class=['"]result-link/.test(html))
console.log('has result-snippet:', /class=['"]result-snippet/.test(html))
const lm = html.match(/<a\b[^>]*class=['"]result-link['"][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/)
console.log('first result-link match:', lm ? lm[1].slice(0,80)+' | '+(lm[2]||'').replace(/<[^>]+>/g,'').slice(0,40) : 'NONE')
