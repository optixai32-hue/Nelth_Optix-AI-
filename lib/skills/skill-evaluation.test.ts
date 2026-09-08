import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'

import { getAdaptiveModePrompt } from '../agents/prompts/search-mode-prompts'
import { INTERNAL_SYSTEMS_DIRECTIVE } from '../agents/researcher'

import { buildSkillContext, type SkillContextMode } from './build-skill-context'

/**
 * The app's provider registry does not wire a `nvidia` provider by default, so
 * the live behavioral test talks to NVIDIA's OpenAI-compatible endpoint
 * directly. This keeps the app architecture untouched while still exercising
 * the real model with the real skill-aware instructions.
 */
const nvidiaProvider = createOpenAICompatible({
  name: 'nvidia',
  apiKey: process.env.NVIDIA_API_KEY ?? '',
  baseURL: 'https://integrate.api.nvidia.com/v1'
})

function getNvidiaModel() {
  return nvidiaProvider(MODEL_ID)
}

/**
 * Behavioral evaluation of the Skill Router → Skill execution pipeline.
 *
 * These tests verify SKILL → MODEL BEHAVIOR, not just that skill text was added
 * to the prompt. The "no model" tests prove Routing selects the right skills
 * (and respects explicit user overrides). The live tests (gated on
 * NVIDIA_API_KEY) actually run Nemotron with the same instructions the
 * researcher would build and assert on the produced artifact.
 *
 * Run live:  NVIDIA_API_KEY=... bun run vitest run lib/skills/skill-evaluation
 */

const MODEL_ID = 'dots-studio/dots-3-note-preview:free'
const LIVE = Boolean(process.env.KILO_API_KEY)

const PROMPT_REACT_TS = `Create a production-grade SaaS analytics dashboard in React + TypeScript.

Requirements:
- modern premium UI
- responsive desktop/tablet/mobile
- light/dark theme
- reusable component architecture
- typed application state
- interactive sidebar
- searchable and sortable data table
- revenue analytics chart
- KPI cards
- activity feed
- loading, empty and error states
- keyboard accessibility
- proper ARIA attributes
- polished hover/focus/active states
- no placeholder components
- no fake unfinished sections

Generate the complete project structure and all required files.

Before returning the result, silently review the implementation for:
architecture, TypeScript safety, React quality, accessibility, responsiveness,
visual quality, completeness and functional consistency.

Return only the final implementation.`

const PROMPT_SVG = `Create a premium, production-quality SVG illustration of a futuristic AI robot.

The SVG must be:
- completely self-contained
- scalable and responsive
- visually sophisticated
- professionally composed
- rich in depth
- using gradients, lighting and subtle shadows
- using clean geometry
- with polished details
- with coherent stroke and fill treatment
- with layered depth
- with carefully controlled visual hierarchy
- without external images
- without placeholder elements

Do not create a basic icon or beginner-level SVG.

Generate the complete SVG and make it suitable for direct preview in a browser.

Silently inspect and improve the SVG before returning it.

Return only the final SVG.`

const PROMPT_VANILLA = `Create a single standalone index.html.

Build a premium interactive landing page for an AI platform.

Constraints:
- HTML + CSS + vanilla JavaScript only
- no React
- no framework
- no external UI library
- responsive
- dark premium aesthetic
- animated hero section
- feature cards
- pricing section
- FAQ accordion
- mobile navigation
- smooth interactions
- accessible keyboard navigation
- polished hover/focus states
- complete and runnable by opening index.html directly

Return only the complete index.html.`

/** Build the exact instructions the researcher would pass to the model.
 *  When `withSkills` is false, produce a clean BASELINE (no skill layer, no
 *  internal directive) so we can compare Nemotron without the skill system. */
async function buildInstructions(
  userPrompt: string,
  withSkills = true,
  mode: SkillContextMode = 'minimal'
): Promise<string> {
  const currentDate = new Date().toLocaleString()
  const base = `${getAdaptiveModePrompt()}\nCurrent date and time: ${currentDate}`
  if (!withSkills) return base
  const skillCtx = await buildSkillContext(userPrompt, mode)
  const skillLayer = skillCtx.context ? `\n\n${skillCtx.context}` : ''
  return `${base}\n\n${INTERNAL_SYSTEMS_DIRECTIVE}${skillLayer}`
}

/** Run Nemotron. Returns the text plus completion token count (for truncation
 *  detection). `withSkills=false` = baseline, `mode` selects minimal/full. */
async function generateWithSkills(
  userPrompt: string,
  opts: { withSkills?: boolean; mode?: SkillContextMode } = {}
): Promise<{ text: string; tokens?: number }> {
  const { text, usage } = await generateText({
    model: getNvidiaModel(),
    system: await buildInstructions(
      userPrompt,
      opts.withSkills ?? true,
      opts.mode ?? 'minimal'
    ),
    prompt: userPrompt,
    maxOutputTokens: 12000,
    abortSignal: AbortSignal.timeout(240_000)
  })
  return { text, tokens: usage?.outputTokens }
}

/** Terms that reveal the internal skill/router machinery to the end user. */
const FORBIDDEN_TERMS = [
  'skill router',
  'skill routing',
  'selected skills',
  'active skill',
  'active skills',
  'react-expert',
  'typescript-pro',
  'visual-craft',
  'progressive disclosure',
  'internal qc',
  'internal validation',
  'execution requirements',
  'execution protocol',
  'active skill execution'
]

/** The model must never leak the existence of the skill machinery. */
function assertNoSkillLeak(out: string): void {
  const lowered = out.toLowerCase()
  for (const term of FORBIDDEN_TERMS) {
    expect(lowered).not.toContain(term)
  }
}

/** Non-throwing variant used by the deterministic A/B/C harness. */
function hasLeak(out: string): boolean {
  const lowered = out.toLowerCase()
  return FORBIDDEN_TERMS.some(term => lowered.includes(term))
}

/**
 * Deterministic behavioral checks. Instead of a flaky judge model, we assert on
 * concrete structural signals in the artifact itself. Each check is a hard
 * pass/fail; the A/B/C harness reports counts so baseline vs minimal vs full can
 * be compared without any nondeterministic scoring.
 */
type Check = { name: string; pass: boolean }

function runChecks(out: string, checks: Check[]) {
  const pass = checks.filter(c => c.pass).length
  return {
    pass,
    total: checks.length,
    fails: checks.filter(c => !c.pass).map(c => c.name)
  }
}

/** A generation is considered truncated if it used near the token cap AND its
 *  final character is not a clean closing token (```, </html>, </svg>, or `}`). */
function isTruncated(out: string, tokens?: number): boolean {
  const nearCap = typeof tokens === 'number' && tokens >= 11500
  const trimmed = out.trimEnd()
  const endsClean =
    /```\s*$/.test(trimmed) ||
    /<\/html>\s*$/i.test(trimmed) ||
    /<\/svg>\s*$/i.test(trimmed) ||
    /}\s*$/.test(trimmed)
  return nearCap && !endsClean
}

function checkReact(out: string): Check[] {
  const low = out.toLowerCase()
  return [
    {
      name: 'html-structure',
      pass: /<(div|section|aside|nav|table|button)/i.test(out)
    },
    { name: 'table', pass: /<(table|thead|tbody|th|tr|td)/i.test(out) },
    {
      name: 'typescript',
      pass: /interface\s+\w+|type\s+\w+\s*=|:\s*react\.|usestate|usereducer/.test(
        low
      )
    },
    { name: 'aria', pass: /aria-/i.test(out) },
    { name: 'responsive', pass: /@media|viewport/.test(low) },
    {
      name: 'no-any',
      pass: !/\bas any\b|<\s*any\s*>|useState<\s*any\s*>|:\s*any\[\]/i.test(out)
    },
    {
      name: 'no-placeholder',
      pass: !/lorem ipsum|todo: implement|not implemented|coming soon|FIXME|\/\/\s*TODO/i.test(
        out
      )
    },
    { name: 'no-leak', pass: !hasLeak(out) }
  ]
}

function checkSvg(out: string): Check[] {
  const low = out.toLowerCase()
  return [
    { name: 'svg', pass: /<svg[\s\S]*<\/svg>/i.test(out) },
    { name: 'gradient', pass: /<(linear|radial)Gradient/i.test(out) },
    { name: 'viewBox', pass: /viewBox/i.test(out) },
    {
      name: 'no-placeholder',
      pass: !/placeholder|lorem ipsum|basic icon|beginner/.test(low)
    },
    { name: 'no-leak', pass: !hasLeak(out) }
  ]
}

function checkVanilla(out: string): Check[] {
  const low = out.toLowerCase()
  return [
    { name: 'doctype', pass: /<!doctype html/i.test(out) },
    { name: 'script', pass: /<script/i.test(out) },
    {
      name: 'no-react',
      pass: !/import\s+(.+\s+)?from\s+['"]react|reactdom|createroot|\.tsx|from\s+['"]react-dom/.test(
        low
      )
    },
    { name: 'no-react-slug', pass: !low.includes('react-expert') },
    { name: 'no-ts-slug', pass: !low.includes('typescript-pro') },
    { name: 'no-leak', pass: !hasLeak(out) }
  ]
}

describe('Skill routing behavioral contract (no model needed)', () => {
  it('React+TS prompt selects react-expert + typescript-pro', async () => {
    const slugs = (await buildSkillContext(PROMPT_REACT_TS)).activated.map(
      a => a.slug
    )
    expect(slugs).toContain('react-expert')
    expect(slugs).toContain('typescript-pro')
  })

  it('SVG robot prompt selects visual-craft', async () => {
    const slugs = (await buildSkillContext(PROMPT_SVG)).activated.map(
      a => a.slug
    )
    expect(slugs).toContain('visual-craft')
  })

  it('vanilla index.html prompt must NOT select react-expert (user override)', async () => {
    const slugs = (await buildSkillContext(PROMPT_VANILLA)).activated.map(
      a => a.slug
    )
    expect(slugs).not.toContain('react-expert')
  })

  it('harness instructions carry execution constraints + invisible-systems directive', async () => {
    const instr = await buildInstructions(PROMPT_REACT_TS)
    expect(instr).toContain('MANDATORY EXECUTION REQUIREMENTS')
    expect(instr).toContain('INTERNAL SYSTEMS ARE INVISIBLE')
    expect(instr).toContain('ACTIVE SKILL EXECUTION PROTOCOL')
  })
})

describe('Behavioral evaluation — Skill → model output (live, requires NVIDIA_API_KEY)', () => {
  it.skipIf(!LIVE)(
    'TEST 1: React+TS dashboard is produced as real, typed, accessible code',
    async () => {
      const { text: out } = await generateWithSkills(PROMPT_REACT_TS)

      // Real UI + table + interactivity, not prose about skills.
      expect(out).toMatch(/<(div|section|aside|nav|table|button)/i)
      expect(out).toMatch(/<(table|thead|tbody|th|tr|td)/i)
      // TypeScript: explicit types / interfaces / hooks.
      expect(out.toLowerCase()).toMatch(
        /interface\s+\w+|type\s+\w+\s*=|:\s*react\.|usestate|usereducer/
      )
      // Accessibility + responsiveness present.
      expect(out).toMatch(/aria-/i)
      expect(out.toLowerCase()).toMatch(/@media|viewport/)
      // No UNSAFE / clearly-avoidable `any` (unsafe assertions, any-typed
      // generics). A benign `e: any` event param is not failed here; the
      // typescript-pro skill says "avoid any unless absolutely unavoidable".
      expect(out).not.toMatch(
        /\bas any\b|<\s*any\s*>|useState<\s*any\s*>|:\s*any\[\]/i
      )
      expect(out).not.toMatch(
        /lorem ipsum|todo: implement|not implemented|coming soon|FIXME|\/\/\s*TODO/i
      )
      assertNoSkillLeak(out)
    },
    200_000
  )

  it.skipIf(!LIVE)(
    'TEST 2: SVG is a sophisticated, self-contained, gradient-rich illustration',
    async () => {
      const { text: out } = await generateWithSkills(PROMPT_SVG)

      expect(out).toMatch(/<svg[\s\S]*<\/svg>/i)
      expect(out).toMatch(/<(linear|radial)Gradient/i)
      expect(out).toMatch(/viewBox/i)
      expect(out).not.toMatch(/placeholder|lorem ipsum|basic icon|beginner/i)
      assertNoSkillLeak(out)
    },
    200_000
  )

  it.skipIf(!LIVE)(
    'TEST 3: vanilla index.html respects "no React" override (no React leakage)',
    async () => {
      const { text: out } = await generateWithSkills(PROMPT_VANILLA)
      const lowered = out.toLowerCase()

      expect(out).toMatch(/<!doctype html/i)
      expect(out).toMatch(/<script/i)
      // Hard constraint from the user: no React / framework.
      expect(lowered).not.toMatch(
        /import\s+(.+\s+)?from\s+['"]react|reactdom|createroot|\.tsx|from\s+['"]react-dom/
      )
      expect(lowered).not.toContain('react-expert')
      expect(lowered).not.toContain('typescript-pro')
      assertNoSkillLeak(out)
    },
    200_000
  )

  it.skipIf(!LIVE)(
    'A/B/C: baseline vs minimal vs full skill context (deterministic)',
    async () => {
      const cases: [string, string, (out: string) => Check[]][] = [
        ['React+TS', PROMPT_REACT_TS, checkReact],
        ['SVG', PROMPT_SVG, checkSvg],
        ['Vanilla', PROMPT_VANILLA, checkVanilla]
      ]
      for (const [label, prompt, check] of cases) {
        const variants = [
          ['baseline', await generateWithSkills(prompt, { withSkills: false })],
          [
            'minimal',
            await generateWithSkills(prompt, {
              withSkills: true,
              mode: 'minimal'
            })
          ],
          [
            'full',
            await generateWithSkills(prompt, { withSkills: true, mode: 'full' })
          ]
        ] as const
        console.log(`\n=== ${label} ===`)
        console.log('variant | checks | tokens | truncated | leak')
        for (const [vname, res] of variants) {
          const r = runChecks(res.text, check(res.text))
          const leak = hasLeak(res.text)
          const trunc = isTruncated(res.text, res.tokens)
          console.log(
            `${vname.padEnd(9)} | ${r.pass}/${r.total}   | ${String(res.tokens ?? '?').padStart(5)}  | ${String(trunc).padEnd(5)} | ${leak}`
          )
        }
      }
    },
    600_000
  )
})
