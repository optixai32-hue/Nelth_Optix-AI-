/**
 * Types for the Skill Router + Progressive Disclosure layer.
 *
 * The layer wraps the main model (thinkingmachines/inkling-small:free, served via the Kilo AI
 * gateway) with an
 * on-demand, OPERATIONAL expertise layer built from the real `claude-skills`
 * repository (`lib/skills/claude-skills`). Skills are not passive documentation:
 * once selected they are ACTIVATED as mandatory instructions with their own
 * workflow, execution rules, and skill-specific validation.
 */

/** Minimal metadata extracted from a skill's SKILL.md frontmatter. */
export interface SkillMeta {
  /** Directory name, e.g. "react-expert". Stable identifier used for routing. */
  slug: string
  /** Human name from frontmatter (`name`). */
  name: string
  /** Short description from frontmatter (`description`). */
  description: string
  /** Domain tag from `metadata.domain` (may be empty). */
  domain: string
  /** Lowercased trigger phrases from `metadata.triggers`. */
  triggers: string[]
  /** Lowercased related skill slugs from `metadata.related-skills`. */
  relatedSkills: string[]
  /** Absolute path to the skill directory (contains SKILL.md + references/). */
  skillDir: string
  /** Reference filenames (e.g. "hooks-patterns.md") within references/. */
  references: string[]
}

/**
 * A skill chosen by the router for a specific request, including the subset of
 * its reference files that are relevant to the task.
 */
export interface SkillSelection {
  slug: string
  name: string
  /** Routing relevance score (higher = more relevant). */
  score: number
  /** Reference filenames to load, already filtered to the relevant ones. */
  references: string[]
  /** True when this skill was inherited from the previous turn (continuity). */
  inherited?: boolean
}

/** A reference file loaded for an activated skill. */
export interface LoadedReference {
  file: string
  content: string
}

/** A skill whose full body + relevant references were loaded from disk. */
export interface LoadedSkill {
  slug: string
  name: string
  /** The skill's `description`, used as the SKILL OBJECTIVE. */
  objective: string
  /** Full SKILL.md body (frontmatter stripped). */
  body: string
  references: LoadedReference[]
  /** Raw registry metadata (domain, triggers, etc.). */
  meta: SkillMeta
}

/**
 * Verifiable lifecycle state of a skill for a single request. The first three
 * states (detected → loaded → active) are confirmed server-side; the remaining
 * states (executing → validated → completed / failed) are driven by the model
 * while it generates and self-reviews. A skill is only ever `completed` when its
 * instructions are genuinely reflected in the output and validation passes.
 */
export type SkillExecutionState =
  | 'detected'
  | 'loaded'
  | 'active'
  | 'executing'
  | 'generated'
  | 'reviewing'
  | 'fixing'
  | 'validated'
  | 'completed'
  | 'failed'

/**
 * Internal, non-user-visible traceability record for one activated skill.
 * Used for observability only — never shown in the chat response.
 */
export interface ActivatedSkill {
  slug: string
  name: string
  objective: string
  /** How many reference files were actually loaded for this skill. */
  refCount: number
  /** Skill-specific validation rules that must be checked after generation. */
  validationRules: string[]
  /** Execution rules the model must follow for this skill. */
  executionRules: string[]
  /** Server-verified state after routing + loading (at least `active`). */
  state: SkillExecutionState
}

/** Debug / observability snapshot (never surfaced to the end user). */
export interface SkillDebugInfo {
  /** Skills the router detected as relevant. */
  detected: string[]
  /** Skills whose SKILL.md was actually read from disk. */
  loaded: string[]
  /** Whether at least one SKILL.md body was loaded. */
  skillMdLoaded: boolean
  /** Whether skill instructions were injected into the model context. */
  instructionsInjected: boolean
  /** Whether the model is instructed to execute (not just mention) the skills. */
  execution: boolean
  /** Whether skill-specific validation was attached. */
  validation: boolean
  /** Whether this request was treated as a follow-up / variation. */
  followUp?: boolean
  /** Classified follow-up intent (MODIFY / ADD / VARIATION / REBUILD) when continuity fired. */
  intent?: string
  /** Previous-turn skills carried into this request for continuity. */
  previousActiveSlugs?: string[]
}

/** Result of building the operational skill system for a single request. */
export interface SkillContextResult {
  /** Model-ready ACTIVE SKILL block injected into the system prompt. */
  context: string
  /** Operational reframing (concrete constraints / criteria / critique / validation). */
  operationalPrompt?: string
  /** The skills that were selected by the router. */
  selected: SkillSelection[]
  /** Internal traceability: the skills that were activated (with rules). */
  activated: ActivatedSkill[]
  /** Flattened skill-specific validation rules (for traceability/logging). */
  validationRules: string[]
  /** Server-verified execution state per activated skill slug. */
  states?: Record<string, SkillExecutionState>
  /** Whether this request was handled as a follow-up / variation (continuity). */
  followUp?: boolean
  /** Classified follow-up intent (MODIFY / ADD / VARIATION / REBUILD) when continuity fired. */
  intent?: string
  /** Previous-turn skills carried into this request for continuity. */
  previousActiveSlugs?: string[]
  /** Previous-design AVOID-LIST text carried into this request for variation continuity. */
  previousDesignSummary?: string
  /** Previous generated code/artifact, carried into this request so follow-ups edit it in place. */
  previousCode?: string
  /** Debug / observability snapshot (detected / loaded / injected / ...). */
  debug?: SkillDebugInfo
}
