import { promises as fs } from 'fs'
import path from 'path'

import {
  extractReferenceHints,
  keywordTokens,
  MAX_REFS_PER_SKILL
} from './router'
import type {
  LoadedReference,
  LoadedSkill,
  SkillMeta,
  SkillSelection
} from './types'

/** Remove the YAML frontmatter fence from a SKILL.md body. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
}

/**
 * Complement the router's filename-overlap reference selection with the skill's
 * OWN signal. The SKILL.md "Reference Guide" table (and inline mentions) name
 * relevant references with a "Load When" description. We score those
 * descriptions against the query tokens and ADD the best matches that the
 * router did not already pick, up to `MAX_REFS_PER_SKILL`.
 *
 * This keeps filename overlap as the primary layer (per the design) and never
 * exceeds progressive-disclosure caps. It only fires when the skill body itself
 * clearly points at a reference for this request.
 */
function selectBodySignaledReferences(
  skill: SkillMeta,
  body: string,
  queryTokens: Set<string>,
  alreadySelected: string[]
): string[] {
  const hints = extractReferenceHints(body)
  if (hints.size === 0) return []

  const selected = new Set(alreadySelected.map(r => r.toLowerCase()))

  const scored = [...hints.entries()]
    .filter(([file]) => skill.references.includes(file))
    .filter(([file]) => !selected.has(file))
    .map(([file, desc]) => {
      let score = 0
      for (const t of keywordTokens(desc)) {
        if (queryTokens.has(t)) score += 1
      }
      return { file, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)

  const room = MAX_REFS_PER_SKILL - alreadySelected.length
  return scored.slice(0, Math.max(0, room)).map(r => r.file)
}

/**
 * Module-level caches for static skill assets. SKILL.md bodies and reference
 * files never change at runtime, so reading them once per process avoids the
 * sequential disk I/O that previously dominated context-build latency on every
 * request (the time before the first streamed token). see OPTIMIZE-TTFT.
 */
const skillBodyCache = new Map<string, string>()
const referenceCache = new Map<string, string>()

async function readSkillBody(skillPath: string): Promise<string | null> {
  const cached = skillBodyCache.get(skillPath)
  if (cached !== undefined) return cached
  try {
    const raw = await fs.readFile(skillPath, 'utf8')
    const body = stripFrontmatter(raw).trim()
    skillBodyCache.set(skillPath, body)
    return body
  } catch {
    return null
  }
}

async function readReference(refPath: string): Promise<string | null> {
  const cached = referenceCache.get(refPath)
  if (cached !== undefined) return cached
  try {
    const raw = (await fs.readFile(refPath, 'utf8')).trim()
    referenceCache.set(refPath, raw)
    return raw
  } catch {
    return null
  }
}

/** Test/utility helper to drop the static asset caches (e.g. after edits). */
export function resetSkillContentCache(): void {
  skillBodyCache.clear()
  referenceCache.clear()
}

/**
 * Progressive Disclosure loader.
 *
 * Given the skills already selected by the router, this loads the FULL
 * SKILL.md body for each selected skill, plus ONLY the relevant reference
 * files that the router chose. All reads are cached (see module caches above)
 * and executed in parallel so the context is built as fast as possible before
 * the model request. Any individual read failure is swallowed so the rest of
 * the context still loads.
 *
 * Returns structured `LoadedSkill` objects (not a pre-formatted string) so the
 * context builder can wrap them as ACTIVE SKILL instructions.
 */
export async function loadSelectedSkillContent(
  selections: SkillSelection[],
  registry: SkillMeta[],
  queryTokens?: Set<string>
): Promise<LoadedSkill[]> {
  const bySlug = new Map(registry.map(s => [s.slug, s]))

  const loaded = await Promise.all(
    selections.map(async (selection): Promise<LoadedSkill | null> => {
      const meta = bySlug.get(selection.slug)
      if (!meta) return null

      const skillPath = path.join(meta.skillDir, 'SKILL.md')
      const skillBody = await readSkillBody(skillPath)
      if (skillBody === null) return null

      // Start from the router's filename-overlap picks, then let the skill body
      // itself signal any additional relevant references (point 12).
      const refNames = [...selection.references]
      if (queryTokens && queryTokens.size > 0) {
        refNames.push(
          ...selectBodySignaledReferences(
            meta,
            skillBody,
            queryTokens,
            refNames
          )
        )
      }

      const references = (
        await Promise.all(
          refNames.map(async (ref): Promise<LoadedReference | null> => {
            const refPath = path.join(meta.skillDir, 'references', ref)
            const content = await readReference(refPath)
            return content === null ? null : { file: ref, content }
          })
        )
      ).filter((r): r is LoadedReference => r !== null)

      return {
        slug: meta.slug,
        name: meta.name,
        objective: meta.description,
        body: skillBody,
        references,
        meta
      }
    })
  )

  return loaded.filter((l): l is LoadedSkill => l !== null)
}
