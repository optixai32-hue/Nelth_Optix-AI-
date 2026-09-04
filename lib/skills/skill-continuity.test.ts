import { describe, expect, it } from 'vitest'

import {
  buildSkillContext,
  getPreviousDesignContext
} from './build-skill-context'
import { getSkillRegistry } from './registry'
import {
  classifyFollowUpIntent,
  isFollowUpVariation,
  routeSkills
} from './router'

/**
 * REAL skill-continuity + design-variation tests.
 *
 * These exercise the EXISTING Skill Router + Skill Context (no new router): a
 * short follow-up must inherit the previous turn's active skill and re-apply it,
 * while varying the design direction instead of resetting to a generic template.
 */

describe('TEST 1 — first request activates frontend-design', () => {
  it('"Create modern landing page" activates frontend-design', async () => {
    const result = await buildSkillContext('Create modern landing page')
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.states?.['frontend-design']).toBe('active')
  })
})

describe('Follow-up detection', () => {
  it('recognises variation phrases', () => {
    expect(isFollowUpVariation('Make another version')).toBe(true)
    expect(isFollowUpVariation('Make it more futuristic')).toBe(true)
    expect(isFollowUpVariation('Try a completely different style')).toBe(true)
    expect(isFollowUpVariation('Refais le hero')).toBe(true)
    expect(isFollowUpVariation('change it')).toBe(true)
  })

  it('does NOT treat a clear domain switch as a follow-up', () => {
    expect(isFollowUpVariation('Write a python script')).toBe(false)
    expect(isFollowUpVariation('Create a react component')).toBe(false)
  })
})

describe('TEST 2/3/4 — follow-up keeps the skill ACTIVE', () => {
  it('TEST 2: "Make another version" keeps frontend-design active', async () => {
    const result = await buildSkillContext(
      'Make another version',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.followUp).toBe(true)
    expect(result.previousActiveSlugs).toContain('frontend-design')
    expect(result.debug?.followUp).toBe(true)
  })

  it('TEST 3: "Make it more futuristic" keeps frontend-design active', async () => {
    const result = await buildSkillContext(
      'Make it more futuristic',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.context).toContain('SKILL CONTINUITY')
  })

  it('TEST 4: "Try a completely different style" keeps frontend-design active', async () => {
    const result = await buildSkillContext(
      'Try a completely different style',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.context).toContain('DESIGN VARIATION')
  })

  it('CONTROL: a follow-up with NO previous context does NOT invent the skill', async () => {
    const result = await buildSkillContext('Make another version')
    expect(result.activated.map(a => a.slug)).not.toContain('frontend-design')
    expect(result.followUp).toBeFalsy()
  })
})

describe('Router inheritance (existing router, no new one)', () => {
  it('inherits previous skill on variation', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills(
      'Make another version',
      registry,
      undefined,
      ['frontend-design']
    )
    expect(selected.map(s => s.slug)).toContain('frontend-design')
    expect(selected.find(s => s.slug === 'frontend-design')?.inherited).toBe(true)
  })

  it('does NOT inherit when the user switches domain', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills(
      'Write a python script',
      registry,
      undefined,
      ['frontend-design']
    )
    expect(selected.map(s => s.slug)).not.toContain('frontend-design')
  })
})

describe('TEST 5/6/7/8/9/10 — continuity directives are genuinely injected', () => {
  async function followUpContext() {
    return (
      await buildSkillContext('Make another version', 'minimal', undefined, [
        'frontend-design'
      ])
    ).context
  }

  it('TEST 5: demands a DIFFERENT visual direction + AVOID-LIST', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('DIFFERENT creative/visual direction')
    expect(ctx).toContain('AVOID-LIST')
  })

  it('TEST 6: font is chosen by direction, not copied; no font explosion', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('FONT RULE')
    expect(ctx).toContain('Inter')
    expect(ctx).toContain('Playfair Display')
    expect(ctx).toContain('Do not load dozens of fonts')
  })

  it('TEST 7: emoji forbidden as UI icons but allowed as on-page TEXT', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('FORBIDDEN as UI icon')
    expect(ctx).toContain('ALLOWED as on-page TEXT content')
  })

  it('TEST 8: conversational emoji in text is still permitted', async () => {
    const ctx = await followUpContext()
    // The on-page TEXT allowance explicitly permits e.g. <h1>Welcome 👋</h1>.
    expect(ctx).toContain('<h1>Welcome')
  })

  it('TEST 9: previously requested functionality is preserved', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('FUNCTIONALITY')
    expect(ctx).toContain('responsive behavior')
  })

  it('TEST 10: final output must be functional CODE, not just a description', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('CODE FIRST')
    expect(ctx).toContain('functional code')
    const result = await buildSkillContext(
      'Make another version',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.states?.['frontend-design']).toBe('active')
  })

  it('variation validation step is attached for design follow-ups', async () => {
    const ctx = await followUpContext()
    expect(ctx).toContain('Design Variation')
    expect(ctx).toContain('GENUINELY DIFFERENT visual direction')
  })

  it('CURRENT ARTIFACT with previous code is injected for MODIFY requests', async () => {
    const result = await buildSkillContext(
      'Improve the animation',
      'minimal',
      undefined,
      ['frontend-design'],
      'font(s): Inter',
      '<!doctype html><html><body><button>Click</button></body></html>'
    )
    expect(result.context).toContain('CURRENT ARTIFACT')
    expect(result.context).toContain('<!doctype html>')
    expect(result.context).toContain('BEGIN CURRENT ARTIFACT')
    expect(result.context).toContain(
      'EDIT THAT EXISTING CODE; do NOT say'
    )
    expect(result.context).toContain('access to the previous code')
    // The hard emoji-as-icon gate is surfaced to the model.
    expect(result.context).toContain('HARD validation gate')
  })

  it('carries previousCode through the result', async () => {
    const result = await buildSkillContext(
      'Fix the button',
      'minimal',
      undefined,
      ['frontend-design'],
      undefined,
      'console.log("previous artifact")'
    )
    expect(result.previousCode).toContain('previous artifact')
  })
})

describe('getPreviousDesignContext — carries the previous code for in-place edits', () => {
  it('returns the previous assistant code as previousCode', async () => {
    const messages = [
      { role: 'user', id: 'u1', parts: [{ type: 'text', text: 'Create modern landing page' }] },
      {
        role: 'assistant',
        id: 'a1',
        parts: [
          {
            type: 'text',
            text:
              'export default function Page(){return <div style={{fontFamily:"Inter",color:"#3366ff"}}>Hi</div>}'
          }
        ]
      },
      { role: 'user', id: 'u2', parts: [{ type: 'text', text: 'Improve the animation' }] }
    ]
    const prev = await getPreviousDesignContext(messages, 'u2')
    expect(prev.slugs).toContain('frontend-design')
    expect(prev.previousCode).toContain('fontFamily')
    expect(prev.designSummary).toContain('Inter')
  })
})

describe('getPreviousDesignContext — derives continuity from history', () => {
  it('recovers the previous active skill from the prior user turn', async () => {
    const messages = [
      { role: 'user', id: 'u1', parts: [{ type: 'text', text: 'Create modern landing page' }] },
      {
        role: 'assistant',
        id: 'a1',
        parts: [
          {
            type: 'text',
            text:
              'export default function Page(){return <div style={{fontFamily:"Inter",color:"#3366ff"}}>Hi</div>}'
          }
        ]
      },
      { role: 'user', id: 'u2', parts: [{ type: 'text', text: 'Make another version' }] }
    ]
    const prev = await getPreviousDesignContext(messages, 'u2')
    expect(prev.slugs).toContain('frontend-design')
    // Design fingerprint captured as an avoid-list.
    expect(prev.designSummary).toContain('Inter')
    expect(prev.designSummary).toContain('#3366ff')
  })

  it('returns empty for a first message (no previous turn)', async () => {
    const messages = [
      { role: 'user', id: 'u1', parts: [{ type: 'text', text: 'Create modern landing page' }] }
    ]
    const prev = await getPreviousDesignContext(messages, 'u1')
    expect(prev.slugs).toHaveLength(0)
  })
})

describe('Follow-up INTENT classification (spec §2)', () => {
  it('classifies surgical edits as MODIFY_EXISTING', () => {
    expect(classifyFollowUpIntent('Make it dark')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Change the colors')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Fix the button')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Make the navbar smaller')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Change the hero')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Improve the animation')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Make it responsive')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Fix the mobile menu')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Make the button blue')).toBe('MODIFY_EXISTING')
  })

  it('classifies appends as ADD_TO_EXISTING', () => {
    expect(classifyFollowUpIntent('Add pricing')).toBe('ADD_TO_EXISTING')
    expect(classifyFollowUpIntent('Add a pricing section')).toBe('ADD_TO_EXISTING')
    expect(classifyFollowUpIntent('Add testimonials')).toBe('ADD_TO_EXISTING')
    expect(classifyFollowUpIntent('Add a contact form')).toBe('ADD_TO_EXISTING')
    expect(classifyFollowUpIntent('Add dark mode')).toBe('ADD_TO_EXISTING')
    expect(classifyFollowUpIntent('Add animations')).toBe('ADD_TO_EXISTING')
  })

  it('classifies restyles as VARIATION_REQUEST', () => {
    expect(classifyFollowUpIntent('Make another version')).toBe('VARIATION_REQUEST')
    expect(classifyFollowUpIntent('Make it more futuristic')).toBe('VARIATION_REQUEST')
    expect(classifyFollowUpIntent('Try a completely different style')).toBe('VARIATION_REQUEST')
    expect(classifyFollowUpIntent('Give me a completely different design')).toBe('VARIATION_REQUEST')
    expect(classifyFollowUpIntent('Refais le design')).toBe('VARIATION_REQUEST')
    expect(classifyFollowUpIntent('Try something more premium')).toBe('VARIATION_REQUEST')
  })

  it('classifies full throwaways as REBUILD_REQUEST', () => {
    expect(classifyFollowUpIntent('Rebuild it from scratch')).toBe('REBUILD_REQUEST')
    expect(classifyFollowUpIntent('Start over')).toBe('REBUILD_REQUEST')
  })

  it('returns null (NEW_PROJECT) for a domain switch or a fresh request', () => {
    expect(classifyFollowUpIntent('Write a python script')).toBeNull()
    expect(classifyFollowUpIntent('Create a modern landing page')).toBeNull()
  })

  it('isFollowUpVariation mirrors non-null classification', () => {
    expect(isFollowUpVariation('Make it dark')).toBe(true)
    expect(isFollowUpVariation('Add pricing')).toBe(true)
    expect(isFollowUpVariation('Write a python script')).toBe(false)
  })

  it('classifies Malagasy follow-ups (amboary, tohizo, averneo)', () => {
    expect(classifyFollowUpIntent('Amboary io')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Ovay ny loko')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Tohizo')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Averneo')).toBe('REBUILD_REQUEST')
    expect(classifyFollowUpIntent('Ampio fizarana iray')).toBe(
      'ADD_TO_EXISTING'
    )
  })

  it('treats bare continuations as thread-preserving', () => {
    expect(classifyFollowUpIntent('Continue')).toBe('MODIFY_EXISTING')
    expect(classifyFollowUpIntent('Encore')).toBe('MODIFY_EXISTING')
  })

  it('keeps Malagasy questions as fresh inquiries (no forced continuity)', () => {
    expect(classifyFollowUpIntent('Inona no dikan izany?')).toBeNull()
    expect(classifyFollowUpIntent('Iza no namorona an ity?')).toBeNull()
  })
})

describe('TEST 2 (corrected) — "Make it dark" MODIFIES, never rebuilds', () => {
  it('keeps frontend-design active and emits a MODIFY-IN-PLACE directive', async () => {
    const result = await buildSkillContext(
      'Make it dark',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.followUp).toBe(true)
    expect(result.intent).toBe('MODIFY_EXISTING')
    expect(result.context).toContain('SKILL CONTINUITY')
    expect(result.context).toContain('MODIFY / EXTEND IN PLACE')
    // A modification must NOT be treated as a redesign: no variation avoid-list.
    expect(result.context).not.toContain('DESIGN VARIATION')
    expect(result.context).not.toContain('AVOID-LIST')
    expect(result.context).not.toContain('DIFFERENT creative/visual direction')
  })
})

describe('TEST 3 (corrected) — "Add pricing section" EXTENDS', () => {
  it('keeps frontend-design active and emits an ADD/extend directive', async () => {
    const result = await buildSkillContext(
      'Add a pricing section',
      'minimal',
      undefined,
      ['frontend-design']
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.intent).toBe('ADD_TO_EXISTING')
    expect(result.context).toContain('MODIFY / EXTEND IN PLACE')
    expect(result.context).toContain('add to existing')
    expect(result.context).toContain('Append the new section only')
    expect(result.context).not.toContain('DESIGN VARIATION')
  })
})

describe('TEST 4 — variation still keeps skill active + avoid-list', () => {
  it('"Make another version" drives a genuine variation with AVOID-LIST', async () => {
    const result = await buildSkillContext(
      'Make another version',
      'minimal',
      undefined,
      ['frontend-design'],
      'font(s): Inter; color(s): #3366ff; layout: centered hero'
    )
    expect(result.activated.map(a => a.slug)).toContain('frontend-design')
    expect(result.intent).toBe('VARIATION_REQUEST')
    expect(result.context).toContain('DESIGN VARIATION')
    expect(result.context).toContain('AVOID-LIST')
    expect(result.context).toContain('DO NOT reuse the previous font')
    expect(result.context).toContain('Inter')
  })
})
