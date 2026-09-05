/**
 * Canonical public base URL of this deployment, used for OAuth redirect URIs
 * (they must match EXACTLY what is registered in each provider console).
 * Prefer APP_BASE_URL; otherwise derive from the incoming request.
 */
export function getAppBaseUrl(headers?: Headers): string {
  const fromEnv = (
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    ''
  ).replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  if (headers) {
    const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? ''
    if (host) {
      const proto =
        headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
      return `${proto}://${host}`.replace(/\/+$/, '')
    }
  }
  return 'http://localhost:3000'
}

export function connectorCallbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/connectors/callback`
}
