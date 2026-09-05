/**
 * OAuth 2.0 provider definitions for real app connectors.
 *
 * One Google OAuth client covers Drive + Gmail + Calendar (scopes below are
 * least-privilege READ-ONLY; the assistant reads, it never writes).
 * GitHub and Notion use their own OAuth apps. All secrets live server-side;
 * the browser only ever sees boolean connection states.
 */

export type ConnectorProviderId = 'google' | 'github' | 'notion'

export interface ConnectorServiceDef {
  id: 'drive' | 'gmail' | 'calendar' | 'github' | 'notion'
  provider: ConnectorProviderId
}

export const CONNECTOR_SERVICES: ConnectorServiceDef[] = [
  { id: 'drive', provider: 'google' },
  { id: 'gmail', provider: 'google' },
  { id: 'calendar', provider: 'google' },
  { id: 'github', provider: 'github' },
  { id: 'notion', provider: 'notion' }
]

export function providerForService(
  serviceId: string
): ConnectorProviderId | null {
  return (
    CONNECTOR_SERVICES.find(s => s.id === serviceId)?.provider ?? null
  )
}

export function servicesForProvider(
  provider: ConnectorProviderId
): ConnectorServiceDef['id'][] {
  return CONNECTOR_SERVICES.filter(s => s.provider === provider).map(s => s.id)
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
  'profile'
].join(' ')

// `repo` covers private repositories too. Narrow to `public_repo` in the
// GitHub OAuth App settings if only public repos are needed.
const GITHUB_SCOPES = ['repo', 'read:user', 'user:email'].join(' ')

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? '').trim()
  if (!value) {
    throw new Error(
      `Connector not configured: missing environment variable ${name}.`
    )
  }
  return value
}

/** Which providers have complete credentials (safe to call client-side). */
export function configuredProviders(): Record<ConnectorProviderId, boolean> {
  const has = (...names: string[]) =>
    names.every(name => (process.env[name] ?? '').trim().length > 0)
  return {
    google: has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    github: has('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
    notion: has('NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET')
  }
}

export interface AuthorizeParams {
  provider: ConnectorProviderId
  redirectUri: string
  state: string
  codeChallenge: string
}

export function buildAuthorizeUrl(params: AuthorizeParams): string {
  const { provider, redirectUri, state, codeChallenge } = params
  if (provider === 'google') {
    const clientId = requiredEnv('GOOGLE_CLIENT_ID')
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GOOGLE_SCOPES)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }
  if (provider === 'github') {
    const clientId = requiredEnv('GITHUB_CLIENT_ID')
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', GITHUB_SCOPES)
    url.searchParams.set('state', state)
    return url.toString()
  }
  const clientId = requiredEnv('NOTION_CLIENT_ID')
  const url = new URL('https://api.notion.com/v1/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('owner', 'user')
  url.searchParams.set('state', state)
  return url.toString()
}

export interface TokenResult {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms, null when the provider issues non-expiring tokens. */
  expiresAt: number | null
  scope?: string
  providerAccountId?: string
  providerAccountName?: string
}

async function postForm(
  url: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const body = new URLSearchParams(params)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString()
  })
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok || !data || typeof data.error !== 'undefined') {
    const detail =
      (data as { error_description?: unknown; error?: unknown } | null)
        ?.error_description ??
      (data as { error?: unknown } | null)?.error ??
      `HTTP ${res.status}`
    throw new Error(`OAuth token exchange failed: ${String(detail)}`)
  }
  return data
}

export async function exchangeCodeForTokens(args: {
  provider: ConnectorProviderId
  code: string
  redirectUri: string
  codeVerifier?: string
}): Promise<TokenResult> {
  const { provider, code, redirectUri, codeVerifier } = args
  if (provider === 'google') {
    const data = (await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(codeVerifier ? { code_verifier: codeVerifier } : {})
    })) as {
      access_token?: unknown
      refresh_token?: unknown
      expires_in?: unknown
      scope?: unknown
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('Google did not return an access token')
    }
    return {
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Date.now() + data.expires_in * 1000
          : null,
      scope: typeof data.scope === 'string' ? data.scope : undefined
    }
  }
  if (provider === 'github') {
    const data = (await postForm(
      'https://github.com/login/oauth/access_token',
      {
        client_id: requiredEnv('GITHUB_CLIENT_ID'),
        client_secret: requiredEnv('GITHUB_CLIENT_SECRET'),
        code,
        redirect_uri: redirectUri
      },
      { Accept: 'application/json' }
    )) as {
      access_token?: unknown
      refresh_token?: unknown
      expires_in?: unknown
      scope?: unknown
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('GitHub did not return an access token')
    }
    return {
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Date.now() + data.expires_in * 1000
          : null,
      scope: typeof data.scope === 'string' ? data.scope : undefined
    }
  }
  const basic = Buffer.from(
    `${requiredEnv('NOTION_CLIENT_ID')}:${requiredEnv('NOTION_CLIENT_SECRET')}`
  ).toString('base64')
  const data = (await postForm(
    'https://api.notion.com/v1/oauth/token',
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    { Authorization: `Basic ${basic}` }
  )) as {
    access_token?: unknown
    bot_id?: unknown
    workspace_name?: unknown
    owner?: unknown
  }
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Notion did not return an access token')
  }
  const owner = data.owner as { user?: { id?: unknown; name?: unknown } } | undefined
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt: null,
    providerAccountId:
      typeof data.bot_id === 'string'
        ? data.bot_id
        : typeof owner?.user?.id === 'string'
          ? owner.user.id
          : undefined,
    providerAccountName:
      typeof data.workspace_name === 'string'
        ? data.workspace_name
        : typeof owner?.user?.name === 'string'
          ? owner.user.name
          : undefined
  }
}

export async function refreshAccessToken(args: {
  provider: ConnectorProviderId
  refreshToken: string
}): Promise<{
  accessToken: string
  expiresAt: number | null
  /** Present when the provider rotated the refresh token (GitHub Apps). */
  refreshToken?: string | null
}> {
  const { provider, refreshToken } = args
  if (provider === 'google') {
    const data = (await postForm('https://oauth2.googleapis.com/token', {
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })) as {
      access_token?: unknown
      expires_in?: unknown
      refresh_token?: unknown
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('Google refresh did not return an access token')
    }
    return {
      accessToken: data.access_token,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Date.now() + data.expires_in * 1000
          : null,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null
    }
  }
  if (provider === 'github') {
    const data = (await postForm(
      'https://github.com/login/oauth/access_token',
      {
        client_id: requiredEnv('GITHUB_CLIENT_ID'),
        client_secret: requiredEnv('GITHUB_CLIENT_SECRET'),
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      },
      { Accept: 'application/json' }
    )) as {
      access_token?: unknown
      expires_in?: unknown
      refresh_token?: unknown
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('GitHub refresh did not return an access token')
    }
    return {
      accessToken: data.access_token,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Date.now() + data.expires_in * 1000
          : null,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null
    }
  }
  throw new Error('This provider issues non-expiring tokens (no refresh)')
}
