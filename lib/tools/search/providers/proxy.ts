import { type Dispatcher,ProxyAgent } from 'undici'

// Optional HTTP(S)/SOCKS proxy for outbound search requests. This lets the
// search providers reach DuckDuckGo / SearXNG from a non-datacenter IP, bypassing
// the anti-bot blocks that serverless (Vercel) IPs hit. Configure via SEARCH_PROXY
// (e.g. http://user:pass@host:port or socks5://host:port).
let cached: Dispatcher | null | undefined

function getProxyDispatcher(): Dispatcher | undefined {
  const url = process.env.SEARCH_PROXY
  if (!url) return undefined
  if (cached === undefined) {
    try {
      cached = new ProxyAgent(url)
    } catch {
      cached = null
      return undefined
    }
  }
  return cached ?? undefined
}

// Returns fetch init options with the proxy dispatcher attached when configured.
export function withProxy(init: RequestInit = {}): RequestInit {
  const dispatcher = getProxyDispatcher()
  return dispatcher ? ({ ...init, dispatcher } as RequestInit) : init
}
