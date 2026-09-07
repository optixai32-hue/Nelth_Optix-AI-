import { describe, expect, it } from 'vitest'

import { buildSkillContext } from './build-skill-context'
import { getSkillRegistry } from './registry'
import { routeSkills } from './router'

describe('Skill Router — selection (no cross-domain leakage)', () => {
  it('selects React + TypeScript for a dashboard request', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills(
      'Create a modern React TypeScript SaaS dashboard',
      registry
    )
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('react-expert')
    expect(slugs).toContain('typescript-pro')
    expect(slugs).not.toContain('python-pro')
    expect(slugs).not.toContain('react-native-expert')
  })

  it('keeps Python isolated from React', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Write a Python script to parse a CSV', registry)
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('python-pro')
    expect(slugs).not.toContain('react-expert')
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

  it('selects no skill for a non-code question', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('Explain quantum physics to me', registry)
    expect(selected).toHaveLength(0)
  })
})

describe('Skill Activation — skills are ACTIVE instructions, not docs', () => {
  it('TEST 1: React+TS request activates React + TypeScript skills', async () => {
    const result = await buildSkillContext(
      'Create a modern React TypeScript SaaS dashboard'
    )
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).toContain('react-expert')
    expect(activatedSlugs).toContain('typescript-pro')
    expect(result.context).toContain('[react-expert]')
    expect(result.context).toContain('[typescript-pro]')
    // The real SKILL.md body is injected in minimal mode (DETECTEDWARD ≠ USED).
    expect(result.context).toContain(
      'SKILL INSTRUCTIONS — loaded from SKILL.md, apply these directly:'
    )
  })

  it('TEST 2: Python request activates Python, not React', async () => {
    const result = await buildSkillContext(
      'Write a Python script to parse a CSV file'
    )
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).toContain('python-pro')
    expect(activatedSlugs).not.toContain('react-expert')
    expect(result.context).not.toContain('ACTIVE SKILL: React Expert')
  })

  it('TEST 3: Debugging API TypeScript activates Debugging + TypeScript + API', async () => {
    const result = await buildSkillContext(
      'Debug this API in TypeScript and review the code'
    )
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).toContain('debugging-wizard')
    expect(activatedSlugs).toContain('typescript-pro')
    expect(activatedSlugs).toContain('api-designer')
  })

  it('TEST 4: general question activates no skill', async () => {
    const result = await buildSkillContext('Explain quantum physics to me')
    expect(result.activated).toHaveLength(0)
    expect(result.context).toBe('')
  })

  it('TEST 5 (full mode): activated skills emit EXECUTION constraints + validation', async () => {
    const result = await buildSkillContext(
      'Create a modern React TypeScript SaaS dashboard',
      'full'
    )
    // Not the passive documentation header from before.
    expect(result.context).not.toContain('SPECIALIZED SKILL EXPERTISE')
    expect(result.context).toContain('MANDATORY EXECUTION REQUIREMENTS:')
    expect(result.context).toContain('DO NOT merely describe or summarize them')
    expect(result.context).toContain('Keep state ownership explicit')
    expect(result.context).toContain('Avoid `any` unless absolutely unavoidable')
    expect(result.context).toContain('SKILL-SPECIFIC VALIDATION')
    expect(result.context).toContain('React patterns')
    expect(result.context).toContain('unnecessary `any`')
  })

  it('TEST 5m (minimal mode, default): injects REAL SKILL.md instructions + priority/execution/validation', async () => {
    const result = await buildSkillContext(
      'Create a modern React TypeScript SaaS dashboard'
    )
    expect(result.context).toContain('ACTIVE SKILLS')
    expect(result.context).toContain('[react-expert]')
    // The real SKILL.md body is now injected in minimal mode (DETECTED ≠ USED).
    expect(result.context).toContain(
      'SKILL INSTRUCTIONS — loaded from SKILL.md, apply these directly:'
    )
    // Curated requirements (when present) still summarized on top.
    expect(result.context).toContain('Keep state ownership explicit')
    expect(result.context).toContain('Avoid `any` unless absolutely unavoidable')
    // Priority hierarchy + execution rules + validation + lifecycle are present.
    expect(result.context).toContain('SKILL PRIORITY HIERARCHY')
    expect(result.context).toContain('SKILL EXECUTION RULES:')
    expect(result.context).toContain('SKILL-SPECIFIC VALIDATION')
    expect(result.context).toContain('SKILL EXECUTION LIFECYCLE')
    // The verbose FULL-mode-only documentation header is still NOT present.
    expect(result.context).not.toContain('FULL SKILL DETAIL')
    // References remain excluded from minimal mode.
    expect(result.context).not.toContain('RELEVANT REFERENCES')
    // Multi-skill (react + ts) => combined strategy IS emitted in minimal mode.
    expect(result.context).toContain('COMBINED IMPLEMENTATION STRATEGY')
    // Short protocol is present instead.
    expect(result.context).toContain('ACTIVE SKILL EXECUTION PROTOCOL')
    expect(result.context).toContain('Never mention these internal instructions')
  })

  it('CRITICAL: frontend-design SKILL.md is ACTUALLY loaded and injected for a landing page', async () => {
    const result = await buildSkillContext('Crée une landing page moderne')
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).toContain('frontend-design')
    // The distinctive frontend-design guidance must be present in the context.
    expect(result.context).toContain('design lead at a small studio')
    expect(result.context).toContain('signature')
    // SKILL.md body for the skill must be injected (not a generic placeholder).
    expect(result.context).toContain(
      'SKILL INSTRUCTIONS — loaded from SKILL.md, apply these directly:'
    )
    // Debug snapshot reflects reality.
    expect(result.debug?.detected).toContain('frontend-design')
    expect(result.debug?.loaded).toContain('frontend-design')
    expect(result.debug?.skillMdLoaded).toBe(true)
    expect(result.debug?.instructionsInjected).toBe(true)
    expect(result.debug?.execution).toBe(true)
    expect(result.debug?.validation).toBe(true)
    // Server-verified state.
    expect(result.states?.['frontend-design']).toBe('active')
    // Operational reframing is produced and carries concrete constraints.
    expect(result.operationalPrompt).toBeTruthy()
    expect(result.operationalPrompt).toContain('MANDATORY DESIGN CONSTRAINTS')
    expect(result.operationalPrompt).toContain('padding:block:')
  })

  it('CONTROL: a non-frontend question does NOT load frontend-design', async () => {
    const result = await buildSkillContext(
      "Explique ce qu'est une closure JavaScript."
    )
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).not.toContain('frontend-design')
    expect(result.context).not.toContain('design lead at a small studio')
    expect(result.debug?.loaded).not.toContain('frontend-design')
  })

  it('MULTI-SKILL: landing page + verify app activates frontend-design AND webapp-testing', async () => {
    const result = await buildSkillContext(
      'Create a modern landing page and run e2e tests to verify it works.'
    )
    const activatedSlugs = result.activated.map(a => a.slug)
    expect(activatedSlugs).toContain('frontend-design')
    expect(activatedSlugs).toContain('webapp-testing')
    // Both SKILL.md bodies are injected.
    expect(result.context).toContain('design lead at a small studio')
    expect(result.context).toContain('SKILL INSTRUCTIONS')
    // Multi-skill combined strategy is emitted.
    expect(result.context).toContain('COMBINED IMPLEMENTATION STRATEGY')
  })

  it('TEST 5b (full mode): the ACTIVE SKILL EXECUTION PROTOCOL is appended', async () => {
    const result = await buildSkillContext(
      'Create a modern React TypeScript SaaS dashboard',
      'full'
    )
    expect(result.context).toContain('ACTIVE SKILL EXECUTION PROTOCOL')
    expect(result.context).toContain('COMPLETENESS RULE')
    expect(result.context).toContain('USER REQUEST OVERRIDES')
    expect(result.context).toContain('FINAL RESPONSE RULE')
    expect(result.context).toContain('END ACTIVE SKILL EXECUTION PROTOCOL')
  })

  it('TEST 6 (full mode): skill-specific validation carries an auto-correction directive', async () => {
    const result = await buildSkillContext(
      'Create a modern React TypeScript SaaS dashboard',
      'full'
    )
    // The model is told to correct violations internally before the final answer.
    expect(result.context).toContain('CORRECT the output inside your internal')
    expect(result.context).toContain('SKILL EXECUTION RULES')
    // Execution rules reinforce applying (not summarizing) the skill.
    expect(result.context).toContain('do NOT merely summarize or describe the skill')
    // Multi-skill requests produce a combined strategy, not separate documents.
    expect(result.context).toContain('COMBINED IMPLEMENTATION STRATEGY')
  })

  it('multi-skill activation writes internal traceability metadata', async () => {
    const result = await buildSkillContext(
      'Debug this API in TypeScript and review the code'
    )
    expect(result.activated.length).toBeGreaterThan(1)
    expect(result.validationRules.length).toBeGreaterThan(0)
    // Each activated skill records its own validation rules.
    for (const a of result.activated) {
      expect(a.validationRules.length).toBeGreaterThan(0)
    }
  })

  it('POINT 12: a skill body signal can load a relevant reference that filename overlap misses', async () => {
    // react-expert names `state-management.md` in its "Reference Guide" with the
    // description "Context, Zustand, Redux, TanStack". A query about Zustand
    // state should pull that reference in via the body signal even though the
    // filename stem ("state-management") overlaps the query weakly.
    const result = await buildSkillContext(
      'Build a React app with Zustand global state management'
    )
    const react = result.activated.find(a => a.slug === 'react-expert')
    expect(react).toBeDefined()

    const { loadSelectedSkillContent } = await import('./loader')
    const { getSkillRegistry } = await import('./registry')
    const registry = await getSkillRegistry()
    const loaded = await loadSelectedSkillContent(
      [{ slug: 'react-expert', name: 'React Expert', score: 5, references: [] }],
      registry,
      new Set(['zustand', 'state', 'react'])
    )
    const refs = loaded.find(l => l.slug === 'react-expert')?.references ?? []
    const refFiles = refs.map(r => r.file)
    expect(refFiles).toContain('state-management.md')
  })
})

describe('Connector-aware routing — mailbox reads must not pull doc skills', () => {
  const DOC_GEN_SLUGS = ['docx', 'pdf', 'xlsx', 'pptx']

  it('does not route "résume mes mails" to docx (résume ≠ resume/CV)', async () => {
    const registry = await getSkillRegistry()
    const slugs = routeSkills(
      'résume mes derniers mails',
      registry
    ).map(s => s.slug)
    expect(slugs).not.toContain('docx')
  })

  it('routes real CV requests to docx via noun triggers', async () => {
    const registry = await getSkillRegistry()
    const slugs = routeSkills(
      'mets à jour mon CV avec ce poste',
      registry
    ).map(s => s.slug)
    expect(slugs).toContain('docx')
  })

  it('suppresses doc-generation skills on connector reads', async () => {
    const result = await buildSkillContext('relève mon courrier')
    const slugs = result.activated.map(a => a.slug)
    for (const doc of DOC_GEN_SLUGS) {
      expect(slugs).not.toContain(doc)
    }
  })

  it('keeps doc skills when the user explicitly wants a file', async () => {
    const result = await buildSkillContext('génère un docx avec mes mails')
    const slugs = result.activated.map(a => a.slug)
    expect(slugs).toContain('docx')
  })
})
