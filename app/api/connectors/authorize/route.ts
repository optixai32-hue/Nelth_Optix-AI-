import { NextResponse } from 'next/server'

import { getCurrentUserId } from '@/lib/auth/get-current-user'
import {
  issueState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  OAUTH_VERIFIER_COOKIE} from '@/lib/connectors/oauth-state'
import {
  buildAuthorizeUrl,
  type ConnectorProviderId
} from '@/lib/connectors/providers'
import { connectorCallbackUrl, getAppBaseUrl } from '@/lib/connectors/urls'

export const runtime = 'nodejs'

const PROVIDERS: ConnectorProviderId[] = ['google', 'github', 'notion']

function cookieFlags(maxAgeMs: number): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000)
  }
}

/**
 * Starts a real OAuth flow: validates the user + provider config, mints a
 * signed state + PKCE pair (httpOnly cookies), and 302-redirects to the
 * provider. Opened in a popup by the connector UI.
 */
export async function GET(req: Request) {
  const userId = await getCurrentUserId().catch(() => null)
  if (!userId) {
    return new Response('Authentication required to connect apps', {
      status: 401
    })
  }
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') as ConnectorProviderId | null
  if (!provider || !PROVIDERS.includes(provider)) {
    return new Response('Unknown provider (google, github, notion)', {
      status: 400
    })
  }

  let authorizeUrl: string
  let issued: ReturnType<typeof issueState>
  try {
    issued = issueState(provider, userId)
    authorizeUrl = buildAuthorizeUrl({
      provider,
      redirectUri: connectorCallbackUrl(getAppBaseUrl(req.headers)),
      state: issued.state,
      codeChallenge: issued.codeChallenge
    })
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : 'Connector not configured',
      { status: 400 }
    )
  }

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set(OAUTH_STATE_COOKIE, issued.state, cookieFlags(OAUTH_STATE_TTL_MS))
  res.cookies.set(
    OAUTH_VERIFIER_COOKIE,
    issued.codeVerifier,
    cookieFlags(OAUTH_STATE_TTL_MS)
  )
  return res
}
