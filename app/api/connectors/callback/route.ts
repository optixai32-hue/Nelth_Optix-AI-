import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  verifyState
} from '@/lib/connectors/oauth-state'
import { exchangeCodeForTokens } from '@/lib/connectors/providers'
import { connectorCallbackUrl, getAppBaseUrl } from '@/lib/connectors/urls'
import { saveConnection } from '@/lib/connectors/vault'

export const runtime = 'nodejs'

/** Popup landing page: reports the outcome to the opener, then closes. */
function landingPage(ok: boolean, provider: string, message: string): string {
  const payload = JSON.stringify({
    type: ok ? 'nelth-connector-connected' : 'nelth-connector-error',
    provider,
    message
  })
  const safe = payload.replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${
    ok ? 'Connected' : 'Connection failed'
  }</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333}</style></head><body><p>${ok ? 'Connected — you can close this window.' : 'Connection failed — you can close this window.'}</p><script>(function(){try{if(window.opener){window.opener.postMessage(${safe},window.location.origin)}}catch(e){}window.close();setTimeout(function(){document.body.innerHTML='<p>You can now close this window and return to Nelth-IA.</p>'},500)})();</script></body></html>`
}

/**
 * OAuth callback: validates state (query vs httpOnly cookie), exchanges the
 * code (PKCE verifier from cookie), seals tokens into the user vault, clears
 * the dance cookies, and lands on a page that notifies the opener window.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const providerError =
    url.searchParams.get('error_description') ?? url.searchParams.get('error')
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? null
  const verifier = cookieStore.get(OAUTH_VERIFIER_COOKIE)?.value ?? null

  const done = (html: string, status = 200) => {
    const res = new NextResponse(html, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    })
    res.cookies.delete(OAUTH_STATE_COOKIE)
    res.cookies.delete(OAUTH_VERIFIER_COOKIE)
    return res
  }

  if (providerError || !code) {
    return done(
      landingPage(false, 'unknown', String(providerError ?? 'Denied')),
      400
    )
  }

  try {
    const { provider, userId } = verifyState(stateParam, stateCookie)
    const tokens = await exchangeCodeForTokens({
      provider,
      code,
      redirectUri: connectorCallbackUrl(getAppBaseUrl(req.headers)),
      codeVerifier: verifier ?? undefined
    })
    await saveConnection(userId, provider, tokens)
    return done(landingPage(true, provider, 'Connected'))
  } catch (err) {
    return done(
      landingPage(
        false,
        'unknown',
        err instanceof Error ? err.message : 'Connection failed'
      ),
      400
    )
  }
}
