import { getCurrentUserId } from '@/lib/auth/get-current-user'
import type { ConnectorProviderId } from '@/lib/connectors/providers'
import { deleteConnection } from '@/lib/connectors/vault'

export const runtime = 'nodejs'

const PROVIDERS: ConnectorProviderId[] = ['google', 'github', 'notion']

/**
 * Revokes a stored connection (deletes the sealed tokens). The provider-side
 * grant remains until the user also revokes it in the provider's own
 * security settings — the UI copy says so.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId().catch(() => null)
  if (!userId) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  let provider: unknown = null
  try {
    provider = (await req.json())?.provider ?? null
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!PROVIDERS.includes(provider as ConnectorProviderId)) {
    return Response.json(
      { error: 'Unknown provider (google, github, notion)' },
      { status: 400 }
    )
  }
  await deleteConnection(userId, provider as ConnectorProviderId)
  return Response.json({ ok: true })
}
