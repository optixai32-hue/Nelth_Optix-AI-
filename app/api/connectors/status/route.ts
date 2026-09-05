import { getCurrentUserId } from '@/lib/auth/get-current-user'
import {
  configuredProviders,
  type ConnectorProviderId,
  servicesForProvider} from '@/lib/connectors/providers'
import { hasConnection } from '@/lib/connectors/vault'

export const runtime = 'nodejs'

type ServiceId = 'drive' | 'gmail' | 'calendar' | 'github' | 'notion'

const ALL_SERVICES: ServiceId[] = [
  'drive',
  'gmail',
  'calendar',
  'github',
  'notion'
]

/**
 * Connection states for the connector UI. Booleans only — token material
 * never leaves the server. Guests get all-false + guest:true (UI prompts
 * sign-in instead of connecting).
 */
export async function GET() {
  const userId = await getCurrentUserId().catch(() => null)
  const configured = configuredProviders()
  const connected: Record<ServiceId, boolean> = {
    drive: false,
    gmail: false,
    calendar: false,
    github: false,
    notion: false
  }
  if (userId) {
    const providers: ConnectorProviderId[] = ['google', 'github', 'notion']
    const checks = await Promise.all(
      providers.map(async provider => {
        try {
          return (await hasConnection(userId, provider))
            ? servicesForProvider(provider)
            : []
        } catch {
          return []
        }
      })
    )
    for (const ids of checks.flat()) {
      connected[ids as ServiceId] = true
    }
  }
  return Response.json({ connected, configured, guest: !userId })
}
