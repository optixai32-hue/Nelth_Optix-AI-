import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none"><rect width="400" height="300" fill="#18181b"/><path d="M160 130a20 20 0 100-40 20 20 0 000 40zm-40 90l35-45 25 30 35-45 65 60H120z" fill="#3f3f46"/></svg>`

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://duckduckgo.com/'
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const targetUrl = searchParams.get('url')
  const thumbUrl = searchParams.get('thumb')

  if (!targetUrl && !thumbUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }

  const urlsToTry: string[] = []
  if (thumbUrl && isValidHttpUrl(thumbUrl)) urlsToTry.push(thumbUrl)
  if (targetUrl && isValidHttpUrl(targetUrl)) urlsToTry.push(targetUrl)

  for (const url of urlsToTry) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4500)

      const res = await fetch(url, {
        headers: FETCH_HEADERS,
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (res.ok) {
        const contentType = res.headers.get('content-type') || 'image/jpeg'
        if (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream')) {
          const body = await res.arrayBuffer()
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': contentType.startsWith('image/') ? contentType : 'image/jpeg',
              'Cache-Control':
                'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
              'Access-Control-Allow-Origin': '*'
            }
          })
        }
      }
    } catch {
      /* try next url */
    }
  }

  // If all failed, return clean SVG placeholder
  return new Response(FALLBACK_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    }
  })
}
