/**
 * Streaming-side enforcement hook.
 *
 * After the researcher agent finishes streaming an answer, we validate the
 * produced output against the active skills. If validation fails (invalid CSS,
 * broken HTML, generic template, etc.) we run a bounded generate → validate →
 * fix loop using the same researcher, and replace the final message text with
 * the refined (passing) result before it is persisted. This makes the saved /
 * finalized answer ENFORCED, not just detected.
 *
 * The router, loader, buildSkillContext and researcher are all reused — this is
 * purely an add-on to the existing pipeline.
 */

import type { ModelMessage } from 'ai'

import { researcher } from '@/lib/agents/researcher'
import type { Model } from '@/lib/types/models'
import type { SearchMode } from '@/lib/types/search'
import { getTextFromParts } from '@/lib/utils/message-utils'

import { EXECUTION_REQUIREMENTS_BY_SLUG } from './build-skill-context'
import { SkillEnforcementEngine } from './enforce'
import { resolveConversationLanguage } from './language-memory'
import type { SkillContextResult } from './types'
import { stripEmojisFromCodeBlocks } from './ui-icon-validator'
import { validateGeneratedOutput } from './validate'

interface EnforceOptions {
  responseMessage: { parts?: unknown[]; role?: string }
  userQuery: string
  skillCtx: SkillContextResult
  model: string
  modelConfig: Model | undefined
  searchMode: SearchMode | undefined
  modelMessages: ModelMessage[]
}

/** Replace the text content of a message's parts with a single refined block. */
function setTextInMessage(message: { parts?: unknown[] }, text: string): void {
  const parts = (message.parts as Array<{ type: string; text?: string }>) ?? []
  let replaced = false
  for (const p of parts) {
    if (p.type === 'text' && !replaced) {
      p.text = text
      replaced = true
    } else if (p.type === 'text') {
      p.text = ''
    }
  }
  if (!replaced) parts.push({ type: 'text', text })
}

/**
 * Strip emoji from any generated code/artifact blocks in a message, regardless
 * of which skill (if any) is active. Conversational text outside code blocks is
 * preserved (emoji used as on-page copy stays). Returns true when modified.
 *
 * This is the deterministic fix for "emoji-in-generated-code": the weak model
 * keeps re-inserting emoji-as-UI-icons even when no visual skill is active, so
 * the cleanup must run on EVERY artifact response, not only for visual skills.
 */
export function stripEmojiFromCodeInMessage(message: { parts?: unknown[] }): boolean {
  const text = getTextFromParts(message.parts as never)
  if (!text) return false
  const cleaned = stripEmojisFromCodeBlocks(text)
  if (cleaned === text) return false
  setTextInMessage(message, cleaned)
  return true
}

/**
 * Build the explicit "apply the active skill" prompt used to force the weak
 * non-thinking model through a reinforcement pass. It lists each active skill's
 * concrete requirements so the re-generation visibly satisfies them, instead of
 * repeating a draft that merely looked valid.
 */
function buildSkillReinforcePrompt(
  userQuery: string,
  skillCtx: SkillContextResult
): string {
  const skills = skillCtx.activated
    .map(a => {
      const reqs = a.validationRules.length ? a.validationRules : [a.objective]
      // Merge the curated, concrete execution requirements (when present) so the
      // model is told EXACTLY what to do, not just the abstract objective. This
      // is what makes the stepfun/Kilo thinking model genuinely APPLY the skill
      // instead of echoing a generic version of it.
      const curated = EXECUTION_REQUIREMENTS_BY_SLUG[a.slug]
      const allReqs = curated && curated.length ? [...reqs, ...curated] : reqs
      return `- ${a.name} (${a.slug}):\n${allReqs.map(r => `   • ${r}`).join('\n')}`
    })
    .join('\n')
  return `TASK: ${userQuery}

Your previous answer did NOT clearly apply the ACTIVE SKILL(S). Rewrite the final result so it VISIBLY satisfies the requirements below — do not merely describe them, apply them directly to the actual output (real code, real domain rules).

ACTIVE SKILLS TO APPLY (each bullet is a MANDATORY execution constraint):
${skills}

Return ONLY the improved final result that demonstrably reflects every bullet above.`
}

/**
 * Validate the agent's answer and, if it fails active-skill validation, refine
 * it in place. Failures are non-fatal: the original answer is kept if the
 * refinement itself errors.
 */
export async function enforceSkillOutput(opts: EnforceOptions): Promise<void> {
  const { responseMessage, userQuery, skillCtx, model, modelConfig, searchMode, modelMessages } =
    opts

  if (!skillCtx.activated.length) return

  const draft0 = getTextFromParts(responseMessage.parts as never)
  if (!draft0) return

  const slugs = skillCtx.activated.map(a => a.slug)
  const bodies = skillCtx.activated.map(a => a.objective)

  // Nelth-3.5 (tencent/hy3:free) and minimax-m3:free are the weak non-thinking
  // models. They tend to "apply the skills a little" — i.e. they produce a
  // structurally-valid answer that ignores the active skill's substance. We
  // therefore FORCE a reinforcement pass for them even when the first
  // validation passes, so the ACTIVE SKILLS are genuinely applied.
  //
  // Nelth-3.5 Thinking (stepfun/step-3.7-flash:free, served from the Kilo gateway) is a stronger reasoning
  // model, BUT in practice it also ignores the active skill's substance on its
  // first pass (e.g. it emits emoji section headers / emoji-as-icon and does
  // NOT apply skills-main). So it is NO LONGER trusted and is held to the same
  // standard: it is forced through the skill-application reinforcement pass too.
  const isWeakModel = /(tencent\/hy3|hy3:free|minimax)/i.test(model)
  const isThinkingModel = /(stepfun|step-3\.7-flash|nelth-3\.5 thinking|thinking)/i.test(
    model
  )

  // Visual/frontend artifacts must never contain emoji used as UI icons.
  const VISUAL_SKILLS = new Set([
    'frontend-design',
    'visual-craft',
    'web-artifacts-builder',
    'website-clone'
  ])
  const isVisualSkill = skillCtx.activated.some(a => VISUAL_SKILLS.has(a.slug))

  // DETERMINISTIC cleanup: strip emoji from any generated code block up front,
  // so the validated/persisted artifact is already clean — independent of the
  // weak model re-inserting emoji. Only code blocks are touched; conversational
  // text outside code is preserved.
  let draft = draft0
  if (isVisualSkill) {
    const cleaned = stripEmojisFromCodeBlocks(draft0)
    if (cleaned !== draft0) {
      setTextInMessage(responseMessage, cleaned)
      draft = cleaned
    }
  }

  const first0 = validateGeneratedOutput(draft0, {
    query: userQuery,
    slugs,
    bodies,
    intent: skillCtx.intent,
    previousDesignSummary: skillCtx.previousDesignSummary
  })
  const first = validateGeneratedOutput(draft, {
    query: userQuery,
    slugs,
    bodies,
    intent: skillCtx.intent,
    previousDesignSummary: skillCtx.previousDesignSummary
  })
  // If the ONLY original problem was emoji-in-code (now stripped), do not waste
  // a reinforcement pass on the weak model — the artifact is already clean.
  const onlyEmojiViolations =
    first0.violations.length > 0 &&
    first0.violations.every(v => v.rule === 'ui.emoji-as-icon')

  if (first.passed && !isWeakModel && !isThinkingModel) {
    if (process.env.SKILL_ROUTER_DEBUG === 'true') {
      console.log('[SkillRouter] enforcement: first generation validation PASSED')
    }
    return
  }
  if (process.env.SKILL_ROUTER_DEBUG === 'true') {
    console.log(
      `[SkillRouter] enforcement: ${
        first.passed
          ? onlyEmojiViolations
            ? 'emoji stripped; no other issues — clean'
            : 'weak model → forcing skill-application pass'
          : `validation FAILED (${first.summary})`
      }; refining…`
    )
  }

  try {
    const engine = new SkillEnforcementEngine(skillCtx.activated)
    const skillContext = skillCtx.operationalPrompt
      ? `${skillCtx.context}\n\n${skillCtx.operationalPrompt}`
      : skillCtx.context
    const agent = await researcher({
      model,
      modelConfig,
      searchMode,
      skillContext,
      conversationLanguage: resolveConversationLanguage(modelMessages, userQuery)
    })

    const generate = async (prompt: string): Promise<string> => {
      const res = await agent.generate({
        messages: [...modelMessages, { role: 'user', content: prompt } as never]
      })
      const t = (res as unknown as { text?: string }).text ?? ''
      return typeof t === 'string' ? t : ''
    }

    // When forcing the weak or thinking model, drive the pass with an explicit
    // "apply the active skill" prompt listing each skill's concrete
    // requirements, so the re-generation visibly satisfies them instead of
    // repeating a draft that merely looked valid.
    const forceApply = first.passed && (isWeakModel || isThinkingModel)
    const basePrompt = forceApply
      ? buildSkillReinforcePrompt(userQuery, skillCtx)
      : `TASK: ${userQuery}\n\nProduce the final result now.`

    const out = await engine.run(generate, basePrompt, {
      query: userQuery,
      slugs,
      bodies,
      // The weak (Nelth-3.5) and thinking (Nelth-3.5 Thinking / stepfun) models
      // both tend to produce a structurally-valid answer that ignores the skill's
      // substance. Give the forced pass the same correction budget as a failed
      // normal generation so it can re-refine until the skill is genuinely applied.
      maxIterations: forceApply ? 2 : undefined
    })

    if (out.finalContent && out.finalContent.trim() && out.finalContent !== draft) {
      let finalContent = out.finalContent
      if (isVisualSkill) finalContent = stripEmojisFromCodeBlocks(finalContent)
      setTextInMessage(responseMessage, finalContent)
      if (process.env.SKILL_ROUTER_DEBUG === 'true') {
        console.log(
          `[SkillRouter] enforcement: refined after ${out.iterations} iteration(s); passed=${out.passed}`
        )
      }
    }
  } catch (e) {
    if (process.env.SKILL_ROUTER_DEBUG === 'true') {
      console.log('[SkillRouter] enforcement refinement error:', String(e).slice(0, 200))
    }
  }
}
