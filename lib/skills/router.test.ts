import { describe, expect, it } from 'vitest'

import { getSkillRegistry } from './registry'
import { routeSkills } from './router'

describe('Skill Router (progressive disclosure)', () => {
  it('loads the real claude-skills registry from disk', async () => {
    const registry = await getSkillRegistry()
    expect(registry.length).toBeGreaterThan(50)

    const react = registry.find(s => s.slug === 'react-expert')
    expect(react).toBeDefined()
    expect(react?.triggers).toContain('react')
    expect(react?.references.length).toBeGreaterThan(0)
  })

  it('selects React + TypeScript for a dashboard request (not unrelated skills)', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills(
      'Create a modern React TypeScript SaaS dashboard',
      registry
    )
    const slugs = selected.map(s => s.slug)

    expect(slugs).toContain('react-expert')
    expect(slugs).toContain('typescript-pro')
    // Progressive disclosure: Python must NOT load for a React request.
    expect(slugs).not.toContain('python-pro')
    // Family de-dup: narrower variant must not piggy-back on react-expert.
    expect(slugs).not.toContain('react-native-expert')
  })

  it('selects debugging + code review for a debug request', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills(
      'Debug this API in TypeScript and review the code',
      registry
    )
    const slugs = selected.map(s => s.slug)

    expect(slugs).toContain('debugging-wizard')
    expect(slugs).toContain('code-reviewer')
  })

  it('does not load any skill for a non-code question', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Explain quantum physics to me', registry)
    expect(selected).toHaveLength(0)
  })

  it('routes a generic visual task to the visual-craft skill via the visual fallback', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Create a premium SVG of a rabbit', registry)
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('visual-craft')
  })

  it('routes a French game request to game-developer', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Crée un jeu snake en HTML', registry)
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('game-developer')
  })

  it('routes an English game request to game-developer', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Build a playable tetris game', registry)
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('game-developer')
  })

  it('routes a French website request to frontend-design', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Crée un site vitrine pour une boulangerie', registry)
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('frontend-design')
  })
})
