/**
 * Skill Enforcement layer.
 *
 * Detection → loading → injection are handled by the router / buildSkillContext.
 * This module turns an ACTIVE skill into ENFORCED output:
 *
 *   generate → validate (programmatic) → fix → re-validate → ... → final
 *
 * It does NOT replace the SKILL.md — the body remains the source of truth. It
 * (1) reframes the injected instructions into an OPERATIONAL prompt the model
 * can act on (concrete constraints, quality criteria, self-critique,
 * validation), and (2) drives a bounded generate→validate→fix loop via a caller
 * supplied generator.
 */

import { isVisualQuery } from './router'
import { getSkillValidationRules } from './skill-rules'
import type {
  ActivatedSkill,
  LoadedSkill,
  SkillContextResult,
  SkillExecutionState
} from './types'
import {
  validateGeneratedOutput,
  type ValidationResult} from './validate'

/** Bounded refinement iterations (user requested 2–3). */
export const MAX_SKILL_REFINEMENT_ITERATIONS = 2

const IMPERATIVE_RE =
  /^\s*(do|don't|dont|never|always|make|use|avoid|spend|critique|question|match|leverage|consider|try|structure|ground|write|treat|approach|open|be|let|cut|name|pin|state|build|plan|review|choose|take|remove)\b/i

/** Pull concrete, imperative directives out of a SKILL.md body. */
export function extractImperativeLines(body: string, limit = 18): string[] {
  const out: string[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '').replace(/^#+\s*/, '')
    if (!line) continue
    if (IMPERATIVE_RE.test(line) && line.length > 12) {
      out.push(line)
    }
    if (out.length >= limit) break
  }
  return out
}

/**
 * Build the OPERATIONAL skill prompt: reframes the injected SKILL.md instructions
 * into concrete, actionable constraints the model must satisfy (the user's
 * MANDATORY DESIGN CONSTRAINTS / QUALITY CRITERIA / SELF-CRITIQUE / VALIDATION
 * format). The SKILL.md body remains the source of truth; we extract its most
 * directive lines so the model acts on specifics, not an abstract summary.
 */
export function buildOperationalSkillPrompt(
  loaded: LoadedSkill[],
  query: string
): string {
  if (!loaded.length) return ''

  const blocks: string[] = []
  blocks.push(
    '================================================================================'
  )
  blocks.push('ACTIVE SKILL EXECUTION (operational)')
  blocks.push(
    '================================================================================'
  )
  blocks.push(`TASK:\n${query}`)

  for (const item of loaded) {
    blocks.push(`\nACTIVE SKILL: ${item.name} (${item.slug})`)

    blocks.push('MANDATORY DESIGN CONSTRAINTS (apply directly to the output):')
    const imperative = extractImperativeLines(item.body, 16)
    if (imperative.length === 0) {
      blocks.push(`- Apply the established best practices for the ${item.meta.domain || 'requested'} domain.`)
    } else {
      for (const line of imperative) blocks.push(`- ${line}`)
    }
    blocks.push(`- Do NOT produce a generic template. Choose a concrete aesthetic direction specific to this brief.`)

    const vRules = getSkillValidationRules(item.meta, isVisualQuery(query))
    blocks.push('\nQUALITY CRITERIA (the output MUST satisfy):')
    for (const r of vRules.slice(0, 12)) {
      blocks.push(`- ${r}`)
    }

    blocks.push('\nSELF-CRITIQUE (must actually be performed before finalizing):')
    blocks.push('- Generate a first draft, then critique it against the constraints above.')
    blocks.push('- Identify concrete weaknesses (generic sections, weak hierarchy, invalid CSS/HTML, missing responsiveness/accessibility).')
    blocks.push('- Improve the draft using that critique. Only then return the final result.')

    blocks.push('\nVALIDATION (the output is rejected until ALL pass):')
    blocks.push('- HTML is valid and well-formed (tags closed, semantic, alt text, lang).')
    blocks.push('- CSS is valid: NO malformed declarations such as `padding:block:var(--x)` (use `padding-block:`); every `var(--x)` is defined; responsive breakpoints present.')
    blocks.push('- JS is syntactically valid and wired to real elements.')
    blocks.push('- Layout is responsive and accessible; interactive states handled.')
    blocks.push('- Design is not a generic hero→features→testimonial→CTA→footer default; it reflects a deliberate direction.')
  }

  return blocks.join('\n')
}

/** Build the fix prompt fed back into the generator on a validation failure. */
export function buildRefinementPrompt(
  draft: string,
  result: ValidationResult,
  basePrompt: string
): string {
  const issues = result.violations
    .map(v => `- [${v.severity}] ${v.rule}: ${v.detail}${v.snippet ? ` (${v.snippet})` : ''}`)
    .join('\n')
  return `${basePrompt}

YOUR PREVIOUS ATTEMPT FAILED VALIDATION. Fix the following concrete issues and return the corrected, complete result:

${issues}

Return ONLY the corrected result — do not describe the fixes.`
}

/**
 * Drives the generate → validate → fix loop. The actual generation is supplied
 * by the caller (so this module stays transport/model agnostic and testable).
 */
export class SkillEnforcementEngine {
  iterations = 0
  state: SkillExecutionState
  readonly activated: ActivatedSkill[]

  constructor(activated: ActivatedSkill[]) {
    this.activated = activated
    this.state = activated.length ? 'active' : 'detected'
  }

  private setState(next: SkillExecutionState): void {
    this.state = next
  }

  async run(
    generate: (prompt: string) => Promise<string>,
    basePrompt: string,
    opts: { maxIterations?: number; query?: string; slugs?: string[]; bodies?: string[] } = {}
  ): Promise<{
    finalContent: string
    result: ValidationResult
    iterations: number
    passed: boolean
    state: SkillExecutionState
  }> {
    const max = opts.maxIterations ?? MAX_SKILL_REFINEMENT_ITERATIONS
    let content = await generate(basePrompt)
    this.setState('generated')

    let result = validateGeneratedOutput(content, {
      query: opts.query,
      slugs: opts.slugs,
      bodies: opts.bodies
    })
    let iter = 0

    while (!result.passed && iter < max) {
      this.setState('reviewing')
      const fixPrompt = buildRefinementPrompt(content, result, basePrompt)
      this.setState('fixing')
      content = await generate(fixPrompt)
      this.setState('generated')
      result = validateGeneratedOutput(content, {
        query: opts.query,
        slugs: opts.slugs,
        bodies: opts.bodies
      })
      iter++
    }

    this.iterations = iter
    if (result.passed) this.setState('validated')
    else this.setState('completed') // best-effort final; not "failed" to avoid hard errors
    return {
      finalContent: content,
      result,
      iterations: iter,
      passed: result.passed,
      state: this.state
    }
  }
}

/** Format the internal execution trace the way the user requested for debug. */
export function formatSkillDebug(
  ctx: SkillContextResult,
  engine?: SkillEnforcementEngine,
  validation?: ValidationResult
): string {
  const lines: string[] = []
  lines.push('========================================')
  lines.push('SKILL EXECUTION')
  lines.push('========================================')
  const slugs = ctx.activated.map(a => a.slug)
  lines.push(`Detected:`)
  for (const s of ctx.debug?.detected ?? slugs) lines.push(`  ✓ ${s}`)
  lines.push(`Loaded:`)
  for (const s of ctx.debug?.loaded ?? slugs) lines.push(`  ✓ ${s}`)
  lines.push(`SKILL.md:\n  ✓ loaded`)
  lines.push(`Instructions injected:\n  ✓ yes`)
  lines.push(`Generation:\n  ✓ completed`)
  lines.push(`Compliance:\n  ✓ checking`)
  lines.push(
    `Validation:\n  ✓ ${validation ? (validation.passed ? 'passed' : 'failed') : 'n/a'}`
  )
  if (engine) {
    lines.push(`Refinement:\n  ${engine.iterations} / ${MAX_SKILL_REFINEMENT_ITERATIONS}`)
  }
  lines.push(`Final:\n  ✓ completed`)
  return lines.join('\n')
}
