import { getTextFromParts } from '@/lib/utils/message-utils'
import { perfTime } from '@/lib/utils/perf-logging'
import { loadSelectedSkillContent } from './loader'
import { getSkillRegistry } from './registry'
import {
  classifyFollowUpIntent,
  type FollowUpIntent,
  isVisualQuery,
  keywordTokens,
  routeSkills
} from './router'
import { getSkillValidationRules, SKILL_EXECUTION_RULES } from './skill-rules'
import { buildOperationalSkillPrompt } from './enforce'
import type {
  ActivatedSkill,
  LoadedSkill,
  SkillContextResult,
  SkillDebugInfo,
  SkillExecutionState,
  SkillSelection
} from './types'

/**
 * Curated OPERATIONAL requirements per skill slug. These are the actionable
 * execution constraints surfaced to the model INSTEAD of (or on top of) the raw
 * SKILL.md body. When a slug has an entry, the model sees crisp "MUST apply"
 * bullets; the full SKILL.md is still attached as detail underneath.
 *
 * This is the SKILL.md → operational-rules transformation: the model receives
 * directives it must satisfy in the code, not a document to read.
 */
export const EXECUTION_REQUIREMENTS_BY_SLUG: Record<string, string[]> = {
  'react-expert': [
    'Use appropriate component boundaries.',
    'Keep components focused and single-responsibility.',
    'Separate UI, state, data and domain concerns.',
    'Use hooks appropriately (rules of hooks, no missing deps).',
    'Avoid unnecessary re-renders (memoization where it matters).',
    'Handle loading / error / empty states when applicable.',
    'Preserve accessibility (semantics, ARIA, focus order, keyboard).',
    'Keep state ownership explicit (local vs context vs store).'
  ],
  'typescript-pro': [
    'Use strict, explicit domain types.',
    'Avoid `any` unless absolutely unavoidable.',
    'Prefer discriminated unions for state variants.',
    'Keep public interfaces explicit.',
    'Handle null / undefined safely.',
    'Avoid unsafe type assertions (`as`).',
    'Keep functions focused and fully typed.',
    'Validate external data at boundaries.'
  ],
  'javascript-pro': [
    'Use modern, idiomatic ES syntax.',
    'Handle async/await without unhandled rejections.',
    'Avoid accidental globals; keep modules clean.',
    'Handle edge cases and errors explicitly.',
    'Prefer explicit, typed structures over loose objects.'
  ],
  'python-pro': [
    'Write idiomatic Python (PEP 8).',
    'Add type hints where they add value.',
    'Avoid bare `except:`; catch specific exceptions.',
    'No undefined names or missing imports.',
    'Validate inputs and external data at boundaries.'
  ],
  'golang-pro': [
    'Return errors; do not panic for expected failures.',
    'Keep interfaces small and explicit.',
    'Use goroutines/channels safely (no data races).',
    'Handle contexts and cancellation correctly.'
  ],
  'rust-engineer': [
    'Respect ownership / borrowing (no unsafe escapes).',
    'Use Result/Option deliberately for errors.',
    'Avoid data races; concurrency must be sound.',
    'Prefer explicit error types over panics.'
  ],
  'java-architect': [
    'Separate layers / modules cleanly.',
    'Handle exceptions and null-safety deliberately.',
    'Close resources (try-with-resources).',
    'Keep public APIs explicit and stable.'
  ],
  'sql-pro': [
    'Parameterize queries (no string concatenation / injection).',
    'Use indexes and joins sensibly.',
    'Guard multi-step writes with transactions.',
    'Validate and type external inputs.'
  ],
  'api-designer': [
    'Model resources and naming consistently.',
    'Define explicit request/response contracts and versions.',
    'Define authn/authz and error shapes.',
    'Validate input at the boundary.'
  ],
  'architecture-designer': [
    'Match the structure to stated requirements and scale.',
    'Separate responsibilities cleanly.',
    'Reflect key trade-offs in the design.',
    'Keep boundaries and contracts explicit.'
  ],
  'nextjs-developer': [
    'Use App Router and Server vs Client components appropriately.',
    'Follow Next.js data fetching and Server Actions patterns.',
    'Avoid unnecessary client-side waterfalls.',
    'Keep route handlers explicit and validated.'
  ],
  'vue-expert': [
    'Use the Composition API and reactivity idiomatically.',
    'Structure components with clear props/emits.',
    'Manage state with the appropriate Vue mechanism.',
    'Preserve accessibility and explicit component boundaries.'
  ],
  'debugging-wizard': [
    'Identify the root cause, not just the symptom.',
    'Target the cause with a minimal fix.',
    'Check side effects and regressions from the fix.',
    'Verify the fix against the original failure.'
  ],
  'code-reviewer': [
    'Eliminate critical bugs and logic errors.',
    'Address security issues (injection, authz, secrets).',
    'Keep code maintainable and readable.',
    'Follow the project’s naming and structure conventions.'
  ],
  'visual-craft': [
    'Produce a polished visual hierarchy.',
    'Use consistent spacing and typography.',
    'Use responsive, scalable composition.',
    'Avoid generic / basic visual treatment.',
    'Use gradients, depth and coherent stroke / fill where relevant.'
  ],
  'frontend-design': [
    'CODE MODIFICATION CONTINUITY: when the user asks to modify, improve, fix, animate, optimize, restyle, extend or adjust an EXISTING generated interface, DO NOT rebuild from scratch, DO NOT replace the HTML structure, existing components or icons unnecessarily, and DO NOT introduce emoji as UI icons. Preserve existing functionality, interactions and content. Change ONLY what the request requires (e.g. "improve the animation" → animations only; "make it dark" → theme tokens only; "fix the mobile menu" → menu behavior only).',
    'CODE-FIRST MODIFICATION RULE: if the conversation already contains a generated code artifact, treat it as the source of truth. When the user asks for an improvement / modification / fix / animation / responsive / feature change, ALWAYS edit that existing artifact and return the modified version — never generate an unrelated replacement from scratch. Preserve every unrelated UI component, interaction, content, asset and icon; change only the requested scope.',
    'DETECTED ≠ LOADED ≠ APPLIED: the skill counts as applied ONLY when its principles demonstrably shape the final code. Loading the SKILL.md is never enough on its own — the output must show a real art direction, intentional typography, a visual signature, and intentional, accessible motion.',
    'FINAL QUALITY GATE (frontend-design = PASS only if ALL hold): skill loaded + design principles genuinely applied + code valid/functional + NO emoji used as UI icons + responsive (viewport <meta> + fluid units / grid / flex + breakpoints down to mobile) + distinctive (NOT the generic hero → 3 cards → testimonial → CTA → footer default). If any fails, refine before returning.',
    'For a NEW design: pick a concrete art direction and a fitting typeface pairing (do not auto-repeat Inter); use an asymmetrical / editorial / bento / immersive / split layout when it fits; add at least ONE distinctive visual signature element (custom SVG, unusual grid, layered background, typographic composition, subtle motion system). Run the internal DESIGN REVIEW checklist before finalizing.',
    'MOTION must be intentional and respect prefers-reduced-motion; avoid permanent useless animation, excessive bounce / glow, or animating every element.',
    'Use real UI icons (reuse an existing icon library, or inline <svg> / vector icons); never use emoji as icon glyphs in the code.',
    'Emoji are allowed ONLY as on-page TEXT content (e.g. <h1>Build faster 🚀</h1>), never as UI icon slots.',
    'Before adding an icon dependency, check package.json and reuse an existing library (Lucide / Phosphor / Heroicons) instead of adding a new one.',
    'Apply the frontend-design workflow: plan → critique → build → critique again.',
    'Meet the quality floor: responsive, accessible (semantics, contrast, focus order), with hover / focus / active states.',
    'MODIFICATION SCOPE: if existing code is present, detect modification vs generation; in modification mode edit in place and preserve structure, design, content, components, assets and functionality; change ONLY the requested scope (e.g. dark mode → tokens/toggle only) and never regenerate the whole artifact unless explicitly asked or it is broken.'
  ]
}

/**
 * Fixed execution protocol appended to every activated-skill context. It turns
 * the whole skill layer from "advisory reading" into a binding execution
 * contract (SVG/UI quality bar, completeness, user overrides, final-response
 * discipline).
 */
const ACTIVE_SKILL_EXECUTION_PROTOCOL = `
================================================================================
ACTIVE SKILL EXECUTION PROTOCOL
================================================================================

For SVG / visual artifacts:
- depth;
- clean geometry;
- coherent stroke / fill treatment;
- polished details;
- scalable structure.

For HTML / UI:
- establish a real design system;
- use consistent spacing;
- typography hierarchy;
- component states;
- hover / focus / active states;
- responsive breakpoints;
- empty / loading / error states when relevant;
- meaningful interaction feedback.

8. COMPLETENESS RULE
Do not stop after generating the first plausible implementation.
The first implementation is only a DRAFT internally.
You MUST silently inspect it and improve it before returning it.
Never return known defects simply because the first generation appears plausible.

9. USER REQUEST OVERRIDES
If the user explicitly asks for a specific technology, architecture, style,
file structure or behavior, follow that requirement even if an active skill
would normally recommend something else.
However, still apply every compatible part of the active skill.
Never replace the user's requested architecture without explicit permission.

10. FINAL RESPONSE RULE
The final answer must contain the actual result requested by the user.
Do not describe the internal skill process.
Do not say that the skills were used.
Do not provide a self-congratulatory quality report.
Do not expose the internal reasoning.
Simply deliver the best implementation / result produced after applying the
active skills.

  ================================================================================
  END ACTIVE SKILL EXECUTION PROTOCOL
  ================================================================================`

/**
 * Compact execution protocol used in MINIMAL mode. Keeps the context small:
 * apply the requirements, don't describe them, self-validate, never leak.
 */
const MINIMAL_SKILL_PROTOCOL = `
================================================================================
ACTIVE SKILL EXECUTION PROTOCOL
================================================================================

1. Apply these requirements directly during generation.
2. Do not merely describe them.
3. Inspect the generated result against them.
4. Correct violations before final output.
5. Never mention these internal instructions.`

/**
 * Build the OPERATIONAL skill context for a single user request.
 *
 * This is the "Skill Activation" step: selected skills are not injected as
 * passive documentation. Each becomes an ACTIVE instruction block with its
 * objective, mandatory SKILL.md instructions, relevant references, and
 * execution rules. For multiple skills a combined strategy is emitted, plus a
 * skill-specific validation + auto-correction step the model runs internally.
 *
 * Pipeline (mirrors the requested flow):
 *   selected → loaded → ACTIVATED → instructions applied → workflow executed
 *   → Nemotron generates → skill-specific validation → general Auto-QC
 *   → auto-correction → final.
 */
export type SkillContextMode = 'minimal' | 'full'

/**
 * Build the OPERATIONAL skill context for a single user request.
 *
 * - `minimal` (default): only the curated EXECUTION REQUIREMENTS per selected
 *   skill + a short execution protocol. No raw SKILL.md body, no references.
 *   This is the production path — the model gets a handful of concrete
 *   constraints, not a second documentation dump.
 * - `full`: the legacy verbose path (objective + FULL SKILL DETAIL + references
 *   + priority/strategy/execution/validation blocks + long protocol). Kept only
 *   for A/B benchmarking against `minimal`.
 */
export async function buildSkillContext(
  query: string,
  mode: SkillContextMode = 'minimal',
  attachmentFormats?: string[],
  previousActiveSlugs?: string[],
  previousDesignSummary?: string,
  previousCode?: string,
  compact = false
): Promise<SkillContextResult> {
    const empty: SkillContextResult = {
      context: '',
      selected: [],
      activated: [],
      validationRules: [],
      previousCode: previousCode ?? ''
    }

  if (!query || query.trim().length < 3) return empty

  try {
    const tBuild = performance.now()
    const registry = await getSkillRegistry()
    perfTime('[TTFT] registry index ready', tBuild)
    if (registry.length === 0) return empty

    const intent: FollowUpIntent | null =
      (previousActiveSlugs?.length ?? 0) > 0
        ? classifyFollowUpIntent(query)
        : null
    const followUp = intent != null

    let selections: SkillSelection[] = routeSkills(
      query,
      registry,
      attachmentFormats,
      followUp ? previousActiveSlugs : undefined
    )

    // READ-ONLY INTENT GUARD: when the user uploads a file and asks to READ /
    // ANALYZE / SUMMARIZE it (not to create a new one), do NOT inject a
    // document-generation skill. Injecting one makes the model generate a brand
    // new file before answering — the unwanted "generate then read" behaviour.
    // For a pure read the model should just read the attached file and answer
    // (like ChatGPT). Only block when there is no explicit create/export verb.
    const READ_VERB_RE =
      /\b(lis|lire|lisez|read|reading|analyse|analyze|analys|résum|resum|resume|summari|summary|extrais|extract|comprend|comprenez|understand|parcours|parcour|décris|decris|describe|explique|expliqu|que dit|what does|review)\b/i
    const CREATE_VERB_RE =
      /\b(crée|cree|créer|creer|génère|genere|générer|generer|generate|fais|fait|make|rédige|redige|write|modifie|modify|export|build|produis|produce|transforme|converti|convert)\b/i
    const isReadOnlyIntent =
      (attachmentFormats?.length ?? 0) > 0 &&
      READ_VERB_RE.test(query) &&
      !CREATE_VERB_RE.test(query)
    if (isReadOnlyIntent) {
      const DOC_GEN_DOMAINS = new Set([
        'documents',
        'pdf',
        'spreadsheets',
        'presentations'
      ])
      const filtered = selections.filter(s => {
        const meta = registry.find(r => r.slug === s.slug)
        return !DOC_GEN_DOMAINS.has((meta?.domain ?? '').toLowerCase())
      })
      if (filtered.length !== selections.length) {
        perfTime('[TTFT] read-only intent: dropped document-generation skills', tBuild)
      }
      selections = filtered
    }

    if (selections.length === 0) return empty
    perfTime('[TTFT] skill selection finished (T2)', tBuild)

    const queryTokens = keywordTokens(query)
    const loaded: LoadedSkill[] = await loadSelectedSkillContent(
      selections,
      registry,
      queryTokens
    )
    if (loaded.length === 0) return empty
    perfTime('[TTFT] skill content loaded (T3)', tBuild)

    const isVisual = isVisualQuery(query)
    const skillBlocks: string[] = []
      const activated: ActivatedSkill[] = []
    const allValidation: string[] = []
    const states: Record<string, SkillExecutionState> = {}

    for (const item of loaded) {
      const validation = getSkillValidationRules(item.meta, isVisual)
      allValidation.push(...validation)

      // Server-verified: routed + SKILL.md loaded + context built => active.
      states[item.slug] = 'active'

      activated.push({
        slug: item.slug,
        name: item.name,
        objective: item.objective,
        refCount: item.references.length,
        validationRules: validation,
        executionRules: SKILL_EXECUTION_RULES,
        state: 'active'
      })

      const curated = EXECUTION_REQUIREMENTS_BY_SLUG[item.slug]

      if (mode === 'full') {
        const refsText = item.references.length
          ? item.references
              .map(r => `\n##### REFERENCE — ${r.file}\n${r.content}`)
              .join('\n')
          : '\n(No additional references were selected as relevant for this request.)'

        skillBlocks.push(
          `ACTIVE SKILL: ${item.name} (${item.slug})

PURPOSE:
${item.objective}

MANDATORY EXECUTION REQUIREMENTS:
${curated && curated.length ? curated.map(r => `- ${r}`).join('\n') : `- Apply the established best practices for the ${item.meta.domain || 'requested'} domain.`}

You MUST apply these practices to the actual implementation. They are execution
constraints, NOT documentation. DO NOT merely describe or summarize them — they
must be visibly reflected in the generated code.

FULL SKILL DETAIL (apply, do not only read):
${item.body}

RELEVANT REFERENCES:
${refsText}`
        )
      } else {
        if (compact) {
          // COMPACT mode (for weak / non-thinking models): feed ONLY the curated
          // requirement checklist. The full SKILL.md body (~100+ lines) overwhelms
          // small models and gets ignored, so they skip the skill entirely. A
          // short, explicit checklist is what a weak model can actually follow.
          const blocks: string[] = [`[${item.slug}] ${item.objective}`]
          blocks.push('Apply these DIRECTLY to the generated code:')
          blocks.push(
            ...(curated && curated.length
              ? curated.map(r => `- ${r}`)
              : [`- Apply best practices for the ${item.meta.domain || 'requested'} domain.`])
          )
          skillBlocks.push(blocks.join('\n'))
        } else {
          // MINIMAL (production path): inject the REAL SKILL.md instructions so the
          // model genuinely applies the skill instead of a generic placeholder.
          // Curated requirements (when present) are kept as a concise summary on
          // top of the authoritative SKILL.md body — which is always included.
          const blocks: string[] = [`[${item.slug}]`]
          if (curated && curated.length > 0) {
            blocks.push(
              'KEY REQUIREMENTS (summary):',
              ...curated.map(r => `- ${r}`)
            )
          }
          blocks.push(
            'SKILL INSTRUCTIONS — loaded from SKILL.md, apply these directly:',
            item.body
          )
          skillBlocks.push(blocks.join('\n'))
        }
      }
    }

    const hasDesignSkill = loaded.some(
      l =>
        l.slug === 'frontend-design' ||
        l.meta.domain === 'frontend' ||
        l.meta.domain === 'visual'
    )

    // Multi-skill composition: one combined strategy, not "several documents".
    let strategyBlock = ''
    if (activated.length > 1) {
      const lines = activated
        .map(
          a =>
            `- ${a.name} (${a.slug}) constrains the solution in its domain and MUST be applied together with the other activated skills.`
        )
        .join('\n')
      strategyBlock = `
COMBINED IMPLEMENTATION STRATEGY:
You have multiple activated skills. Treat them as a SINGLE combined
implementation strategy, NOT as separate documents. Apply ALL of their rules
simultaneously when generating the answer:
${lines}`
    }

    // Skill CONTINUITY — only for follow-up turns. The behavior depends on the
    // follow-up intent (see classifyFollowUpIntent):
    //  - VARIATION_REQUEST → drive a GENUINE redesign against a PREVIOUS-DESIGN
    //    AVOID-LIST (different typography, palette, layout, hero, cards, nav…).
    //  - MODIFY_EXISTING / ADD_TO_EXISTING / REBUILD_REQUEST → EDIT THE EXISTING
    //    CODE IN PLACE. Preserve structure, sections, components, interactions,
    //    JS, responsive behavior and accessibility; change ONLY the requested
    //    scope. No forced "new direction", no AVOID-LIST.
    let continuityBlock = ''
    if (followUp) {
      const prevList = (previousActiveSlugs ?? []).join(', ')
      const isVariation = intent === 'VARIATION_REQUEST'

      // CURRENT ARTIFACT — the previous generated code, reproduced verbatim so the
      // model edits THE EXISTING code instead of "not having access" and rebuilding
      // from scratch. This is the CODE-FIRST source of truth. Bounded to keep the
      // context sane; a truncation note is added when the code was cut.
      const MAX_PREV_CODE = 24000
      let currentArtifactBlock = ''
      const rawPrevCode = (previousCode ?? '').trim()
      if (hasDesignSkill && rawPrevCode) {
        const truncated = rawPrevCode.length > MAX_PREV_CODE
        const shown = truncated ? rawPrevCode.slice(0, MAX_PREV_CODE) : rawPrevCode
        currentArtifactBlock = `

CURRENT ARTIFACT (the EXISTING code from the previous turn — you MUST edit THIS, not regenerate a replacement):
${truncated ? '[NOTE: previous code truncated to the last ' + MAX_PREV_CODE + ' characters for context size. The full artifact is still in the conversation above.]' : ''}
---- BEGIN CURRENT ARTIFACT ----
${shown}
---- END CURRENT ARTIFACT ----`
      }

      const variationLine =
        isVariation && hasDesignSkill
          ? `

DESIGN VARIATION (this is an "another version" / variation request):
- Preserve the SAME functional requirements and the SAME skill quality rules.
- Choose a DIFFERENT creative/visual direction: different typography (chosen to
  match the new direction), different color palette, different layout, different
  hero composition, different component/card treatment, different gradients,
  illustrations and decorative components — unless the user explicitly asks to
  keep a specific element.
- PREVIOUS DESIGN (treat as an AVOID-LIST, do NOT copy unless asked):
  ${previousDesignSummary?.trim() ? previousDesignSummary : 'see the previous generated output'}
- FONT RULE: pick typography from a clean set suited to the new direction. DO NOT reuse the previous font(s) listed in the AVOID-LIST above; choose a different one from: Inter, Geist, Manrope, DM Sans, Plus Jakarta Sans, Space Grotesk, Sora, Outfit, IBM Plex Sans, Instrument Sans, Archivo, Source Sans 3, Bricolage Grotesque, Cormorant Garamond, Playfair Display. Reuse an existing project font only when it genuinely fits the new direction; Do not load dozens of fonts.
- ICONS: use an icon library or inline/custom SVG. Emoji are FORBIDDEN as UI icon
  glyphs in code, but REMAIN ALLOWED as on-page TEXT content (e.g. <h1>Welcome 👋</h1>).
- FUNCTIONALITY: keep previously requested features, interactions, buttons,
  responsive behavior and accessibility. Only change visual direction.
- CODE FIRST: output functional code directly; do not ask the user for color/font/
  style choices unless strictly blocking. Make professional decisions.`
          : ''

      const modifyLine =
        !isVariation && hasDesignSkill
          ? `

MODIFY / EXTEND IN PLACE (this is a "${
            intent === 'ADD_TO_EXISTING'
              ? 'add to existing'
              : intent === 'REBUILD_REQUEST'
                ? 'rebuild'
                : 'modify existing'
          }" request):
- The previous turn ALREADY produced code. The EXACT existing code is provided above
  in the CURRENT ARTIFACT block. EDIT THAT EXISTING CODE; do NOT say "I don't have
  access to the previous code" and do NOT generate a new standalone application.
- PRESERVE: HTML structure, existing sections, components, buttons, interactions,
  event listeners, state, existing JavaScript, responsive behavior, accessibility
  and the current theme system.
- CHANGE ONLY the requested scope:
  ${
    intent === 'ADD_TO_EXISTING'
      ? '- Append the new section only; keep everything else byte-for-byte and do NOT rebuild unrelated components.'
      : intent === 'REBUILD_REQUEST'
        ? '- A full rebuild is allowed this time, but keep the SAME domain and purpose and reuse the previous functionality the user relied on.'
        : '- e.g. "improve the animation" → modify animations only; "make it dark" → change the color/theme tokens only; "fix the button" → change that button only; "make it responsive" → add responsive rules only. Do NOT change the layout, typography, copy or unrelated components unless asked.'
  }
- Do NOT remove or silently drop existing functionality simply because it is not
  mentioned in this prompt. Never interpret a modification request as "create a new
  landing page".
- ICONS: use an icon library or inline/custom SVG. Emoji are FORBIDDEN as UI icon
  glyphs in code (this is a HARD validation gate — generation fails if violated),
  but REMAIN ALLOWED as on-page TEXT content (e.g. <h1>Welcome 👋</h1>).
- CODE FIRST: return the full updated code as a modified version of the CURRENT ARTIFACT.`
          : ''

      continuityBlock = `
================================================================================
SKILL CONTINUITY (follow-up / variation request — intent: ${intent})
================================================================================
This is a CONTINUATION of the previous turn. The previous active skill(s)
(${prevList}) REMAIN ACTIVE and their SKILL.md instructions MUST be re-applied to
the new output. Do NOT reset to a generic baseline.${currentArtifactBlock}${variationLine}${modifyLine}
Re-run the full lifecycle for each active skill: detected → loaded → active →
EXECUTING → VALIDATED → COMPLETED.`
    }

    const executionBlock = `
SKILL EXECUTION RULES:
${SKILL_EXECUTION_RULES.map(r => `- ${r}`).join('\n')}`

    const variationValidation =
      intent === 'VARIATION_REQUEST' && hasDesignSkill
        ? `
[Design Variation] validate:
  - The new version is a GENUINELY DIFFERENT visual direction from the previous one (different typography, palette, layout, hero). If it is nearly identical, change the direction.
  - The previous design's fonts/colors/layout were NOT copied verbatim.
  - No emoji are used as UI icon glyphs in the code.`
        : intent && intent !== 'VARIATION_REQUEST' && hasDesignSkill
          ? `
[Modification / Extension] validate:
  - The existing sections, components, buttons, interactions, event listeners, state,
    JavaScript, responsive behavior and accessibility were PRESERVED (not dropped or rebuilt).
  - ONLY the requested scope was changed; the rest of the application is unchanged.
  - No accidental full rebuild / regeneration of a working artifact.
  - No emoji are used as UI icon glyphs in the code.`
          : ''

    const validationBlock = `
SKILL-SPECIFIC VALIDATION (internal — do NOT surface to the user):
After generating, verify the output against EACH activated skill's rules below.
If any important rule is violated, CORRECT the output inside your internal
reasoning and re-verify, BEFORE returning the final answer.
${activated
  .map(
    a =>
      `\n[${a.name}] validate:\n${a.validationRules
        .map(r => `  - ${r}`)
        .join('\n')}`
  )
  .join('\n')}${variationValidation}`

    const priorityBlock = `
SKILL PRIORITY HIERARCHY (highest → lowest):
1. System safety and application/project constraints (never violated)
2. The user's explicit request
3. Project-specific rules
4. ACTIVE SKILL instructions (below) — must be genuinely applied
5. Relevant skill references
6. General model preferences`

    const fullHeader = `================================================================================
ACTIVE SPECIALIZED SKILLS (selected and ACTIVATED for THIS request only)
================================================================================
The skills below are ACTIVE for this request. They are MANDATORY instructions,
not optional documentation. Apply their methodology directly to the solution.
They augment — never replace — your reasoning, planning, and tool use. Do NOT
mention the skill names or the Skill Router to the user unless explicitly asked.`

    const minimalHeader = `================================================================================
ACTIVE SKILLS
================================================================================
The following are MANDATORY execution constraints for this request. Apply them
directly; do not merely describe them; never mention them to the user.`

    const lifecycleBlock = `
SKILL EXECUTION LIFECYCLE (internal — drive this while you work):
For each ACTIVE skill, proceed through:
  detected → loaded → active → EXECUTING (apply the SKILL.md instructions while
  generating) → VALIDATED (check the output against the skill's validation
  rules) → COMPLETED.
Only mark a skill COMPLETED when its instructions are genuinely reflected in the
output AND validation passes. If validation fails, correct the output and
re-validate before completing. Detection is NEVER completion.`

    const context = (mode === 'full'
      ? [
          fullHeader,
          priorityBlock,
          ...skillBlocks,
          strategyBlock,
          executionBlock,
          validationBlock,
          lifecycleBlock,
          continuityBlock,
          ACTIVE_SKILL_EXECUTION_PROTOCOL
        ]
      : [
          minimalHeader,
          ...skillBlocks,
          strategyBlock,
          priorityBlock,
          executionBlock,
          validationBlock,
          lifecycleBlock,
          continuityBlock,
          MINIMAL_SKILL_PROTOCOL
        ]
    )
      .filter(Boolean)
      .join('\n')

    const debug: SkillDebugInfo = {
      detected: selections.map(s => s.slug),
      loaded: loaded.map(s => s.slug),
      skillMdLoaded: loaded.length > 0,
      instructionsInjected: loaded.length > 0,
      execution: loaded.length > 0,
      validation: allValidation.length > 0,
      followUp,
      intent: intent ?? undefined,
      previousActiveSlugs
    }

    if (process.env.SKILL_ROUTER_DEBUG === 'true') {
      console.log(
        `[SkillRouter] query="${query.slice(0, 70)}"\n` +
          `Skills detected:\n${debug.detected.map(s => `- ${s}`).join('\n') || '  (none)'}\n` +
          `Skills loaded:\n${debug.loaded.map(s => `- ${s}`).join('\n') || '  (none)'}\n` +
          `SKILL.md loaded: ${debug.skillMdLoaded ? 'YES' : 'NO'}\n` +
          `Skill instructions injected: ${debug.instructionsInjected ? 'YES' : 'NO'}\n` +
          `Skill execution: ${debug.execution ? 'YES' : 'NO'}\n` +
          `Validation: ${debug.validation ? 'YES' : 'NO'}\n` +
          `ctxLen=${context.length} validationRules=${allValidation.length}`
      )
    }

    const operationalPrompt = compact
      ? ''
      : buildOperationalSkillPrompt(loaded, query)

    return {
      context,
      operationalPrompt,
      selected: selections,
      activated,
      validationRules: Array.from(new Set(allValidation)),
      states,
      followUp,
      intent: intent ?? undefined,
      previousActiveSlugs,
      previousDesignSummary,
      previousCode: previousCode ?? '',
      debug
    }
    perfTime('[TTFT] skill context built (T3)', tBuild)
  } catch (error) {
    console.error('[SkillRouter] buildSkillContext failed:', error)
    return empty
  }
}

/** Result of inspecting the previous conversation turn for skill continuity. */
export interface PreviousDesignContext {
  /** Skills that were ACTIVE on the previous user turn. */
  slugs: string[]
  /** Lightweight fingerprint of the previous design (fonts/colors) as AVOID-LIST. */
  designSummary: string
  /** The previous generated code/artifact text, reproduced for in-place editing. */
  previousCode: string
}

/**
 * Build a PREVIOUS-DESIGN AVOID-LIST used to drive a genuine design variation.
 *
 * A variation must deliberately take a DIFFERENT direction, so we fingerprint the
 * previous generated code across every axis the spec lists as an avoid target:
 * layout, typography/font, color palette, hero composition, card style,
 * navigation style, spacing rhythm and visual motif. The result is a compact
 * textual list the model is told to treat as an AVOID-LIST (do NOT copy these).
 */
function extractDesignSummary(text: string): string {
  if (!text) return ''
  const fonts = new Set<string>()
  const colors = new Set<string>()
  const motifs = new Set<string>()
  const components = new Set<string>()
  const layouts = new Set<string>()
  const spacing = new Set<string>()
  let m: RegExpExecArray | null

  const fontRe = /font-family:\s*([^;"}]+)/gi
  while ((m = fontRe.exec(text))) {
    const f = m[1].trim().replace(/^['"]|['"]$/g, '').split(',')[0].trim()
    if (f) fonts.add(f)
  }
  const fontRe2 = /fontFamily\s*[:=]\s*['"]([^'"]+)['"]/gi
  while ((m = fontRe2.exec(text))) {
    const f = m[1].trim().split(',')[0].trim()
    if (f) fonts.add(f)
  }
  const colorRe = /#([0-9a-fA-F]{3,8})\b/g
  while ((m = colorRe.exec(text))) colors.add('#' + m[1])

  const lower = text.toLowerCase()
  // Layout signals.
  if (/\bgrid\b/.test(lower)) layouts.add('grid')
  if (/\bflex\b/.test(lower)) layouts.add('flex')
  if (/split|two-?column|asymmetric|side-by-side/.test(lower)) layouts.add('split/asymmetric')
  if (/centered|text-center|mx-auto/.test(lower)) layouts.add('centered hero')
  // Navigation style.
  if (/\bnav\b|navbar|navigation bar|header\b/.test(lower)) components.add('top nav/header')
  if (/sidebar|side nav/.test(lower)) components.add('side nav')
  // Card style.
  if (/\bcard\b|cards\b/.test(lower)) components.add('card components')
  if (/bento/.test(lower)) components.add('bento grid')
  // Hero composition.
  if (/\bhero\b/.test(lower)) components.add('hero section')
  if (/immersive|fullscreen|full-?screen/.test(lower)) components.add('immersive hero')
  // Visual motif.
  if (/gradient/.test(lower)) motifs.add('gradient motif')
  if (/\bborder\b|outline/.test(lower)) motifs.add('line/border motif')
  if (/shadow/.test(lower)) motifs.add('soft-shadow motif')
  if (/glass|blur|backdrop/.test(lower)) motifs.add('glassmorphism')
  if (/brutal|neo-?brutal|bold border|thick border/.test(lower)) motifs.add('brutalist motif')
  // Spacing rhythm sample (so a later variation can avoid the same rhythm).
  const spRe = /(padding|margin|gap)[:\s]+([0-9.]+(?:px|rem|em))/gi
  while ((m = spRe.exec(text))) spacing.add(m[2])

  const parts: string[] = []
  if (fonts.size) parts.push('font(s): ' + [...fonts].slice(0, 6).join(', '))
  if (colors.size) parts.push('color(s): ' + [...colors].slice(0, 6).join(', '))
  if (layouts.size) parts.push('layout: ' + [...layouts].join(', '))
  if (components.size) parts.push('components: ' + [...components].join(', '))
  if (motifs.size) parts.push('motif: ' + [...motifs].join(', '))
  if (spacing.size) parts.push('spacing samples: ' + [...spacing].slice(0, 6).join(', '))
  return parts.join('; ')
}

function messageText(msg: {
  role?: string
  parts?: unknown
  content?: unknown
}): string {
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return (msg.content as { type?: string; text?: string }[])
      .filter(p => p && p.type === 'text')
      .map(p => p.text ?? '')
      .join('\n')
  }
  if (Array.isArray(msg.parts)) {
    return getTextFromParts(msg.parts as never)
  }
  return ''
}

/**
 * Inspect the conversation to support SKILL CONTINUITY: find the previous user
 * turn, re-run the EXISTING router on it to recover its active skills, and
 * fingerprint the previous generated design. Returns empty when there is no
 * previous turn (e.g. a brand-new chat), so continuity never fires by accident.
 *
 * This reuses `buildSkillContext` (and therefore the router) — no second router.
 */
export async function getPreviousDesignContext(
  messages: { role?: string; parts?: unknown; id?: string; content?: unknown }[],
  currentMessageId?: string
): Promise<PreviousDesignContext> {
  const tPrev = performance.now()
  const list = [...(messages ?? [])]
  let prevUser: (typeof list)[number] | null = null
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i]
    if (msg.role === 'user' && msg.id !== currentMessageId) {
      prevUser = msg
      break
    }
  }
  if (!prevUser) return { slugs: [], designSummary: '', previousCode: '' }

  const prevQuery = getTextFromParts(prevUser.parts as never)
  if (!prevQuery)
    return { slugs: [], designSummary: '', previousCode: '' }

  // OPTIMIZE-TTFT: derive the previous turn's active skills with the lightweight
  // router ONLY. The previous implementation called the full buildSkillContext
  // here, re-running the entire skill pipeline (registry scan + SKILL.md body
  // loads + validation) a SECOND time before every request — the single largest
  // source of pre-first-token latency. Continuity only needs the slug list.
  const registry = await getSkillRegistry()
  const prevSelections = registry.length ? routeSkills(prevQuery, registry) : []
  const slugs = prevSelections.map(s => s.slug)

  // Best-effort design fingerprint + full code from the most recent assistant
  // output. The previous code is reproduced so a follow-up can EDIT IT IN PLACE
  // (CODE-FIRST MODIFICATION RULE) instead of claiming it has no access to it.
  let assistantText = ''
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant') {
      assistantText = messageText(list[i])
      if (assistantText) break
    }
  }

  perfTime('[TTFT] previous-context resolved', tPrev)
  return {
    slugs,
    designSummary: extractDesignSummary(assistantText),
    previousCode: assistantText
  }
}
