import { type NextRequest, NextResponse } from 'next/server'

import { hasFirebaseConfig, SESSION_COOKIE } from './config'

/**
 * Middleware session guard. Firebase Auth session verification happens in
 * server components / route handlers via `getCurrentUser()` (Admin SDK, which
 * is not edge-compatible). Here we only check for the presence of the session
 * cookie and redirect unauthenticated users away from protected routes.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  if (!hasFirebaseConfig()) {
    return response
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  const publicPaths = ['/', '/auth', '/share', '/api', '/relay']

  const pathname = request.nextUrl.pathname

  if (!hasSession && !publicPaths.some(path => pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  return response
}
