import { describe, expect, it } from 'vitest'

import {
  buildOperationalSkillPrompt,
  buildRefinementPrompt,
  formatSkillDebug,
  MAX_SKILL_REFINEMENT_ITERATIONS,
  SkillEnforcementEngine
} from './enforce'
import type { ActivatedSkill, LoadedSkill, SkillContextResult } from './types'
import { validateGeneratedOutput } from './validate'

const fakeActivated: ActivatedSkill[] = [
  {
    slug: 'frontend-design',
    name: 'Frontend Design',
    objective: 'distinctive visual design',
    refCount: 0,
    validationRules: ['Layout is responsive.', 'UI is visually consistent.'],
    executionRules: [],
    state: 'active'
  }
]

const fakeLoaded: LoadedSkill[] = [
  {
    slug: 'frontend-design',
    name: 'Frontend Design',
    objective: 'distinctive visual design',
    body:
      'Approach this as the design lead. Spend your boldness in one place. Do not produce templated defaults. Critique your own work as you build. Choose a concrete aesthetic direction specific to this brief.',
    references: [],
    meta: { domain: 'frontend' } as never
  }
]

const fakeCtx: SkillContextResult = {
  context: '[frontend-design]',
  activated: fakeActivated,
  selected: [],
  validationRules: ['Layout is responsive.'],
  states: { 'frontend-design': 'active' },
  debug: { detected: ['frontend-design'], loaded: ['frontend-design'], skillMdLoaded: true, instructionsInjected: true, execution: true, validation: true }
}

describe('enforce.ts — operational prompt + lifecycle engine', () => {
  it('buildOperationalSkillPrompt extracts concrete constraints from the SKILL.md body', () => {
    const p = buildOperationalSkillPrompt(fakeLoaded, 'Crée une landing page moderne')
    expect(p).toContain('ACTIVE SKILL: Frontend Design (frontend-design)')
    expect(p).toContain('MANDATORY DESIGN CONSTRAINTS')
    expect(p).toContain('QUALITY CRITERIA')
    expect(p).toContain('SELF-CRITIQUE')
    expect(p).toContain('VALIDATION')
    // Concrete directive pulled from the body, not an abstract summary.
    expect(p).toContain('Do not produce templated defaults')
    expect(p).toContain('padding:block:') // the exact anti-pattern is taught
  })

  it('SkillEnforcementEngine runs generate→validate→fix until passing', async () => {
    const calls: string[] = []
    // 1st gen: invalid CSS (fails). 2nd gen: corrected (passes).
    const generate = async (prompt: string): Promise<string> => {
      calls.push(prompt)
      if (calls.length === 1) {
        return '```css\n.hero { padding:block:var(--s8); }\n```'
      }
      return '```css\n:root { --s8: 2rem; }\n.hero { padding-block: var(--s8); }\n```'
    }

    const engine = new SkillEnforcementEngine(fakeActivated)
    const out = await engine.run(generate, 'Crée une landing page moderne', {
      query: 'Crée une landing page moderne',
      slugs: ['frontend-design'],
      bodies: ['distinctive visual design']
    })

    expect(out.iterations).toBe(1)
    expect(out.passed).toBe(true)
    expect(out.state).toBe('validated')
    expect(calls.length).toBe(2) // draft + one fix
    // The fix prompt must reference the specific violation.
    expect(calls[1]).toContain('css.invalid-property-colon')
  })

  it('Engine stops at MAX iterations and returns best effort', async () => {
    // Generator always returns invalid CSS.
    const generate = async (): Promise<string> =>
      '```css\n.hero { padding:block:var(--s8); }\n```'
    const engine = new SkillEnforcementEngine(fakeActivated)
    const out = await engine.run(generate, 'task', { slugs: ['frontend-design'] })
    expect(out.iterations).toBe(MAX_SKILL_REFINEMENT_ITERATIONS)
    expect(out.passed).toBe(false)
    expect(out.state).toBe('completed')
  })

  it('formatSkillDebug matches the requested debug layout', () => {
    const engine = new SkillEnforcementEngine(fakeActivated)
    const dbg = formatSkillDebug(fakeCtx, engine, validateGeneratedOutput('ok'))
    expect(dbg).toContain('SKILL EXECUTION')
    expect(dbg).toContain('Detected:')
    expect(dbg).toContain('✓ frontend-design')
    expect(dbg).toContain('SKILL.md:')
    expect(dbg).toContain('Refinement:')
    expect(dbg).toContain('Final:')
  })

  it('buildRefinementPrompt lists the concrete violations', () => {
    const r = validateGeneratedOutput('```css\n.hero { padding:block:var(--s8); }\n```')
    const p = buildRefinementPrompt('draft', r, 'TASK: x')
    expect(p).toContain('css.invalid-property-colon')
    expect(p).toContain('FAILED VALIDATION')
  })
})
