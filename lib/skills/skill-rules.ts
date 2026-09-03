import type { SkillMeta } from './types'

/**
 * Execution rules applied to EVERY activated skill. These turn a selected skill
 * from passive documentation into an operational mandate: the model must apply
 * the skill's methodology, follow its workflow, and self-correct violations.
 */
export const SKILL_EXECUTION_RULES: string[] = [
  'Apply the selected skill’s instructions to this task — do NOT merely summarize or describe the skill.',
  'Treat the skill as a MANDATORY constraint on the implementation, not as optional background reading. For this request, the active skill’s rules take precedence over generic defaults.',
  'Follow the skill’s documented workflow, steps, and best practices while generating the solution.',
  'Use the skill’s concrete recommendations for architecture, technical choices, structure, patterns, conventions, validation, debugging, quality, security, testing, and maintainability.',
  'In your INTERNAL reasoning, you MUST actively use the active skill: analyze the request through its lens, walk through its workflow/checklist step by step, and verify your plan against its rules BEFORE you implement. Show the skill’s methodology in your reasoning, not just the final answer.',
  'Do NOT mention the skill name or the Skill Router to the user unless explicitly asked.',
  'The final output MUST reflect the selected skill’s methodology and meet its quality bar.',
  'If any important rule of an activated skill is violated, correct it inside your internal reasoning BEFORE producing the final answer.'
]

/**
 * Skill-specific validation rules, keyed by skill slug (most specific) then by
 * `metadata.domain` (broader). These become the SKILL-SPECIFIC VALIDATION step
 * the model runs internally after generation.
 */
const VALIDATION_BY_SLUG: Record<string, string[]> = {
  'react-expert': [
    'Components are correctly structured (cohesive, single responsibility).',
    'React patterns (hooks rules, composition, state lifting) are applied consistently.',
    'State is managed correctly (local vs context vs external store chosen deliberately).',
    'Props and state are typed when TypeScript is in use.',
    'No stale-closure or missing-dependency bugs in effects.'
  ],
  'typescript-pro': [
    'Strict, consistent types are used throughout.',
    'No unnecessary `any`; precise types or generics are preferred.',
    'Interfaces and types are coherent and clearly named.',
    'Imports resolve and types are mutually compatible (no implicit `any`).',
    'Type errors are anticipated and avoided.'
  ],
  'javascript-pro': [
    'Modern, idiomatic ES syntax is used.',
    'Async/await is handled without unhandled rejections.',
    'No accidental globals; modules are clean.',
    'Edge cases and errors are handled.'
  ],
  'python-pro': [
    'Idiomatic Python (PEP 8) is used.',
    'Type hints are present where they add value.',
    'No bare `except:`; errors are handled specifically.',
    'No undefined names or missing imports.'
  ],
  'golang-pro': [
    'Idiomatic Go (errors returned, not panicked) is used.',
    'Interfaces are small and explicit.',
    'Concurrency uses goroutines/channels safely (no races).'
  ],
  'rust-engineer': [
    'Ownership/borrowing rules are respected (no unsafe escapes).',
    'Errors use Result/Option deliberately.',
    'No data races; concurrency is sound.'
  ],
  'java-architect': [
    'Clear separation of layers / modules.',
    'Exceptions and null-safety handled deliberately.',
    'No resource leaks (try-with-resources / close).'
  ],
  'sql-pro': [
    'Queries are parameterized (no SQL injection).',
    'Indexes and joins are used sensibly.',
    'Transactions guard multi-step writes.'
  ],
  'debugging-wizard': [
    'The root cause was identified, not just the symptom.',
    'The fix targets the cause and is minimal.',
    'Side effects and regressions from the fix were checked.',
    'The fix is verified against the original failure.'
  ],
  'code-reviewer': [
    'No critical bugs or logic errors remain.',
    'Security issues (injection, authz, secrets) are addressed.',
    'The code is maintainable and readable.',
    'Naming and structure follow the project conventions.'
  ],
  'api-designer': [
    'API follows consistent resource modelling and naming.',
    'Request/response contracts are explicit and versioned.',
    'Authn/authz and error shapes are defined.'
  ],
  'architecture-designer': [
    'The chosen structure matches the stated requirements and scale.',
    'Responsibilities are separated cleanly.',
    'Key trade-offs are reflected in the design.'
  ],
  'nextjs-developer': [
    'App Router / Server vs Client components used appropriately.',
    'Server Actions and data fetching follow Next.js patterns.',
    'No unnecessary client-side waterfalls.'
  ],
  'vue-expert': [
    'Composition API and reactivity used idiomatically.',
    'Components are structured with clear props/emits.',
    'State is managed with the appropriate Vue mechanism.'
  ],
  'frontend-design': [
    'No emoji are used as UI icons in the generated code (icons use an icon library or inline <svg> / vector icons).',
    'Emoji used as on-page TEXT content are preserved and never stripped.',
    'The design is distinctive, not the generic hero → features → testimonial → cta → footer default.',
    'RESPONSIVE: a viewport <meta> is present and the layout adapts (fluid units / grid / flex + media queries) down to mobile.',
    'DESIGN PRINCIPLES APPLIED: a concrete art direction, intentional typography pairing, and at least one distinctive visual signature element are visible in the code.',
    'MOTION is intentional and respects prefers-reduced-motion; no permanent useless animation or excessive bounce/glow.',
    'Responsive and accessible (semantics, contrast, focus order), with interactive states.',
    'FINAL QUALITY GATE: frontend-design = PASS only if skill loaded + design principles applied + code functional + no emoji-as-icon + responsive + distinctive. Loading the SKILL.md alone is NOT a successful execution.',
    'MODIFICATION SCOPE: on a modification request the existing code is edited in place; structure, design, content, components and assets are preserved and only the requested scope is changed (no full regeneration, no spontaneous redesign). BEFORE vs AFTER: structure / sections / content / components / assets / functionality preserved, only requested changes added.'
  ],
  'game-developer': [
    'ONE self-contained HTML file (inline CSS/JS, zero network dependencies, no hotlinked assets).',
    'Game loop on requestAnimationFrame with delta-time; pause on visibilitychange.',
    'Responsive canvas (resize + devicePixelRatio); keyboard AND touch controls.',
    'Explicit states: start screen, playing, paused, game over with score + restart (button and key); no autoplay before user input.',
    'Complete mechanics: collision, scoring, difficulty ramp — no TODOs, no dead buttons.',
    'Valid JS (double quotes for apostrophes); French UI copy when the user writes French.'
  ],
  'canvas-design': [
    'Crisp rendering (devicePixelRatio + resize); rAF loop pausing on visibilitychange; static fallback for prefers-reduced-motion.',
    'Self-contained; no external assets unless requested; valid JS.'
  ],
  'web-artifacts-builder': [
    'ONE self-contained interactive HTML file, zero network dependencies.',
    'Every control works (no dead buttons/placeholders); loading/empty/error states handled.',
    'Valid, responsive code; French UI copy when the user writes French.'
  ]
}

const VALIDATION_BY_DOMAIN: Record<string, string[]> = {
  frontend: [
    'Layout is responsive across desktop / tablet / mobile.',
    'UI is visually consistent with a clear visual hierarchy.',
    'Accessibility basics are respected (semantics, contrast, focus order).',
    'Interactive states (hover / focus / active) are handled.',
    'The result reads as a professional product, not a prototype.'
  ],
  language: [
    'The language’s idioms and type/convention system are followed.',
    'Code is robust against the common failure modes of that language.'
  ],
  'api-architecture': [
    'Endpoints / contracts are explicit and consistent.',
    'Error and validation behavior is defined.'
  ],
  quality: [
    'Output passes the skill’s own quality checks.',
    'No critical defects remain.'
  ],
  game: [
    'Playable from the first load: start screen, game loop, game over + restart.',
    'Keyboard and touch controls both work.',
    'No external assets; valid JS with no syntax errors.'
  ],
  canvas: [
    'Renders crisply at any size (devicePixelRatio + resize).',
    'Animation pauses when hidden; static fallback for reduced motion.'
  ],
  security: [
    'No obvious injection / auth / secret vulnerabilities.',
    'Least-privilege and safe defaults are applied.'
  ]
}

/** Visual-specific validation, added for SVG / HTML / CSS / UI tasks. */
const VISUAL_VALIDATION: string[] = [
  'Composition and visual hierarchy are intentional.',
  'Proportions, spacing, and typography are coherent.',
  'Colors, gradients, shadows, and depth are used purposefully.',
  'The result is responsive / scalable where applicable (valid SVG viewBox, fluid layout).',
  'The artifact is valid and renders correctly.'
]

/**
 * Build the skill-specific validation rules for an activated skill.
 * @param skill The skill metadata (slug + domain drive the rules).
 * @param isVisual Whether the request is a visual / frontend / UI task (adds
 *                 the visual validation set).
 */
export function getSkillValidationRules(
  skill: SkillMeta,
  isVisual: boolean
): string[] {
  const rules = [
    ...(VALIDATION_BY_SLUG[skill.slug] ?? []),
    ...(VALIDATION_BY_DOMAIN[skill.domain] ?? [])
  ]
  if (isVisual) rules.push(...VISUAL_VALIDATION)
  // Fallback baseline so EVERY activated skill is still validated. Without this,
  // skills lacking a slug/domain entry (e.g. claude-api, webapp-testing) would
  // ship zero validation rules and effectively skip self-review.
  if (rules.length === 0) {
    rules.push(...(VALIDATION_BY_DOMAIN['quality'] ?? []))
  }
  // De-duplicate while preserving order.
  return Array.from(new Set(rules))
}
