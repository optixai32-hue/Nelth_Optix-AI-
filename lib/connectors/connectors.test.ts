import { afterEach, describe, expect, it } from 'vitest'

import { decryptSecret, encryptSecret } from './crypto'
import { issueState, verifyState } from './oauth-state'
import {
  buildAuthorizeUrl,
  configuredProviders,
  providerForService,
  servicesForProvider
} from './providers'

const SAVED_ENV: Record<string, string | undefined> = {
  CONNECTORS_ENCRYPTION_KEY: process.env.CONNECTORS_ENCRYPTION_KEY,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
  NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('connector crypto vault', () => {
  it('round-trips a token', () => {
    process.env.CONNECTORS_ENCRYPTION_KEY = 'a'.repeat(64)
    const sealed = encryptSecret('secret-token-123')
    expect(sealed).not.toContain('secret-token-123')
    expect(decryptSecret(sealed)).toBe('secret-token-123')
  })

  it('fails closed without a key or on tampering', () => {
    delete process.env.CONNECTORS_ENCRYPTION_KEY
    expect(() => encryptSecret('x')).toThrow()
    process.env.CONNECTORS_ENCRYPTION_KEY = 'a'.repeat(64)
    const sealed = encryptSecret('x')
    // Flip one hex char inside the ciphertext section (keeps format valid).
    const [v, iv, data, tag] = sealed.split('.')
    const flipped = data.slice(0, -1) + (data.endsWith('0') ? '1' : '0')
    expect(() => decryptSecret(`${v}.${iv}.${flipped}.${tag}`)).toThrow()
    process.env.CONNECTORS_ENCRYPTION_KEY = 'b'.repeat(64)
    expect(() => decryptSecret(sealed)).toThrow()
  })
})

describe('oauth state (CSRF protection)', () => {
  it('issues and verifies a matching state+cookie pair', () => {
    process.env.CONNECTORS_ENCRYPTION_KEY = 'a'.repeat(64)
    const issued = issueState('google', 'user-1')
    expect(issued.state).toContain('.')
    expect(issued.codeVerifier.length).toBeGreaterThan(20)
    expect(issued.codeChallenge.length).toBeGreaterThan(20)
    expect(verifyState(issued.state, issued.state)).toEqual({
      provider: 'google',
      userId: 'user-1'
    })
  })

  it('rejects mismatched, missing or tampered state', () => {
    process.env.CONNECTORS_ENCRYPTION_KEY = 'a'.repeat(64)
    const issued = issueState('github', 'user-2')
    expect(() => verifyState(issued.state, 'other')).toThrow()
    expect(() => verifyState(null, issued.state)).toThrow()
    expect(() => verifyState(`${issued.state}x`, `${issued.state}x`)).toThrow()
  })
})

describe('provider wiring', () => {
  it('maps services to providers (one Google OAuth covers 3 services)', () => {
    expect(providerForService('drive')).toBe('google')
    expect(providerForService('gmail')).toBe('google')
    expect(providerForService('calendar')).toBe('google')
    expect(providerForService('github')).toBe('github')
    expect(providerForService('notion')).toBe('notion')
    expect(providerForService('unknown')).toBeNull()
    expect(servicesForProvider('google')).toEqual([
      'drive',
      'gmail',
      'calendar'
    ])
  })

  it('reports configured providers from env only', () => {
    for (const k of Object.keys(SAVED_ENV)) delete process.env[k]
    expect(configuredProviders()).toEqual({
      google: false,
      github: false,
      notion: false
    })
    process.env.GITHUB_CLIENT_ID = 'id'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    expect(configuredProviders().github).toBe(true)
    expect(configuredProviders().google).toBe(false)
  })

  it('builds authorize URLs with scopes and PKCE', () => {
    process.env.GOOGLE_CLIENT_ID = 'gid'
    process.env.GITHUB_CLIENT_ID = 'hid'
    process.env.NOTION_CLIENT_ID = 'nid'
    const google = buildAuthorizeUrl({
      provider: 'google',
      redirectUri: 'https://x/cb',
      state: 's',
      codeChallenge: 'c'
    })
    expect(google).toContain('accounts.google.com')
    expect(google).toContain(encodeURIComponent('gmail.readonly'))
    expect(google).toContain('code_challenge=c')
    const github = buildAuthorizeUrl({
      provider: 'github',
      redirectUri: 'https://x/cb',
      state: 's',
      codeChallenge: 'c'
    })
    expect(github).toContain('github.com/login/oauth/authorize')
    const notion = buildAuthorizeUrl({
      provider: 'notion',
      redirectUri: 'https://x/cb',
      state: 's',
      codeChallenge: 'c'
    })
    expect(notion).toContain('api.notion.com/v1/oauth/authorize')
  })

  it('refuses to build URLs without credentials (fail closed)', () => {
    for (const k of Object.keys(SAVED_ENV)) delete process.env[k]
    expect(() =>
      buildAuthorizeUrl({
        provider: 'google',
        redirectUri: 'https://x/cb',
        state: 's',
        codeChallenge: 'c'
      })
    ).toThrow()
  })
})
