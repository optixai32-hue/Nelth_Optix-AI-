import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildConnectorContext,
  detectConnectorIntent,
  isStatusOnlyIntent
} from './context'
import { hasConnection } from './vault'

vi.mock('./vault', () => ({
  hasConnection: vi.fn(async () => false),
  getValidAccessToken: vi.fn(async () => 'test-token')
}))

const mockedHasConnection = vi.mocked(hasConnection)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('detectConnectorIntent', () => {
  const positive = [
    'retrouve mes mails sur la facture',
    'cherche dans ma boîte mail',
    'un résumé de mes e-mails reçus',
    'dans mon Drive, le fichier budget',
    'mes événements de la semaine',
    'c’est quoi mon agenda demain ?',
    'ma prochaine réunion',
    'mon repo github principal',
    'retrouve la page Notion sur le projet',
    'qu’est-ce qui est connecté ?',
    'comment connecter Gmail ?',
    'find my latest emails',
    'what is on my calendar tomorrow',
    'search my Notion pages'
  ]
  it.each(positive)('detects: %s', q => {
    expect(detectConnectorIntent(q)).toBe(true)
  })

  const negative = [
    'bonjour',
    'crée une landing page moderne',
    'quel temps fait-il à Paris ?',
    'explique la photosynthèse',
    'merci !'
  ]
  it.each(negative)('ignores: %s', q => {
    expect(detectConnectorIntent(q)).toBe(false)
  })
})

describe('isStatusOnlyIntent', () => {
  it('flags connection questions without data access', () => {
    expect(isStatusOnlyIntent('quelles apps sont connectées ?')).toBe(true)
    expect(isStatusOnlyIntent('lis mes mails')).toBe(false)
  })
})

describe('buildConnectorContext', () => {
  it('lists connected apps and tool rules', async () => {
    mockedHasConnection.mockImplementation(async (_u, p) => p === 'google')
    const { text, anyConnected } = await buildConnectorContext('user-1')
    expect(anyConnected).toBe(true)
    expect(text).toContain('Google (Gmail, Drive, Calendar)')
    expect(text).toContain('NOT connected: GitHub · Notion')
    expect(text).toContain('connector TOOL')
  })

  it('guides to the connector card when nothing is connected', async () => {
    mockedHasConnection.mockResolvedValue(false)
    const { text, anyConnected } = await buildConnectorContext('user-1')
    expect(anyConnected).toBe(false)
    expect(text).toContain('None connected yet.')
    expect(text).toContain('Connecter une application')
  })

  it('reports all disconnected for guests without touching the vault', async () => {
    const { anyConnected } = await buildConnectorContext('guest')
    expect(anyConnected).toBe(false)
    expect(mockedHasConnection).not.toHaveBeenCalled()
  })
})
