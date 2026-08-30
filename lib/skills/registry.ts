import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'

import {
  SKILLS_CLAUDE_ROUTING,
  SKILLS_MAIN_ROUTING} from './skills-main-routing'
import type { SkillMeta } from './types'

/**
 * Root directory of the real `claude-skills` repository.
 *
 * The skills live on disk and are read on demand (progressive disclosure).
 * We resolve from the project root at runtime so this works under the Next.js
 * Node server runtime. Override with SKILLS_DIR if you relocate the data.
 */
const CLAUDE_SKILLS_ROOT =
  process.env.SKILLS_DIR?.trim() ||
  path.join(process.cwd(), 'lib', 'skills', 'claude-skills')

/**
 * Root directory of the official Anthropic Agent Skills (`skills-main/`).
 * These ship only `name` + `description` frontmatter (no `metadata.triggers`),
 * so routing metadata is supplied separately in `skills-main-routing.ts` and
 * merged in at registry-build time — their SKILL.md files are never edited.
 */
function resolveSkillsMainRoot(): string | null {
  const override = process.env.SKILLS_MAIN_DIR?.trim()
  if (override && existsSync(override)) return override

  const candidates = [
    path.join(process.cwd(), 'skills-main', 'skills'),
    path.join(process.cwd(), 'skills-main', 'skills-main', 'skills')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Module-level cache: the lightweight routing index is built only once. */
let registryCache: SkillMeta[] | null = null
let registryUnavailable = false

interface RawFrontmatter {
  name: string
  description: string
  domain: string
  triggers: string
  relatedSkills: string
}

/**
 * Parse the YAML frontmatter of a SKILL.md. We only need a handful of scalar
 * fields plus the indented `metadata:` block, so a tiny parser is sufficient
 * and avoids adding a YAML dependency.
 */
function parseFrontmatter(content: string): RawFrontmatter {
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fence) {
    return {
      name: '',
      description: '',
      domain: '',
      triggers: '',
      relatedSkills: ''
    }
  }

  const fm = fence[1]

  const getTop = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : ''
  }

  // The metadata block is the last section in the frontmatter, indented under
  // `metadata:`. JS regex has no `\Z`, so capture through end of the fm block.
  const metaMatch = fm.match(/metadata:\s*\n([\s\S]*)/)
  const metaBlock = metaMatch ? metaMatch[1] : ''
  const getMeta = (key: string): string => {
    const m = metaBlock.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : ''
  }

  return {
    name: getTop('name'),
    description: getTop('description'),
    domain: getMeta('domain'),
    triggers: getMeta('triggers'),
    relatedSkills: getMeta('related-skills')
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Collect reference markdown filenames from a skill directory. Anthropic skills
 * store guidance under either `references/` (plural, the existing convention)
 * or `reference/` (singular, used by mcp-builder, pdf, etc.). We read both.
 */
async function collectReferences(skillDir: string): Promise<string[]> {
  const dirs = ['references', 'reference']
  const found = new Set<string>()
  for (const dir of dirs) {
    try {
      const refFiles = await fs.readdir(path.join(skillDir, dir))
      for (const f of refFiles) {
        if (f.endsWith('.md')) found.add(f)
      }
    } catch {
      // Directory absent — fine.
    }
  }
  return [...found].sort()
}

/** Apply routing metadata overrides for Anthropic + claude-skills code skills. */
function applyRoutingOverrides(meta: SkillMeta): SkillMeta {
  const override =
    SKILLS_MAIN_ROUTING[meta.slug] || SKILLS_CLAUDE_ROUTING[meta.slug]
  if (!override) return meta
  // Merge additively: keep the skill's own triggers/related skills and SUPPLEMENT
  // them with the curated phrases (so generic/French code requests also match).
  const triggers = Array.from(
    new Set([
      ...meta.triggers,
      ...override.triggers.map(t => t.toLowerCase())
    ])
  )
  const relatedSkills = Array.from(
    new Set([...meta.relatedSkills, ...override.relatedSkills])
  )
  return {
    ...meta,
    domain: meta.domain || override.domain,
    triggers,
    relatedSkills
  }
}

/**
 * Scan one skills root directory and return its `SkillMeta[]` (frontmatter
 * only). `applyOverrides` merges routing metadata for Anthropic skills.
 */
async function scanRoot(root: string): Promise<SkillMeta[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const skills: SkillMeta[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // Skip the doc/example template shipped inside skills-main.
    if (entry.name === 'template') continue

    const skillDir = path.join(root, entry.name)
    const skillFile = path.join(skillDir, 'SKILL.md')

    try {
      const content = await fs.readFile(skillFile, 'utf8')
      const fm = parseFrontmatter(content)
      if (!fm.name) continue

      const references = await collectReferences(skillDir)

      const meta: SkillMeta = {
        slug: entry.name,
        name: fm.name,
        description: fm.description,
        domain: fm.domain,
        triggers: splitList(fm.triggers),
        relatedSkills: splitList(fm.relatedSkills),
        skillDir,
        references
      }
      skills.push(applyRoutingOverrides(meta))
    } catch {
      // Skip any skill that cannot be read without breaking the index.
      continue
    }
  }

  return skills
}

/**
 * Build (and cache) the routing index by scanning the frontmatter of every
 * SKILL.md across BOTH skill roots:
 *   1. `lib/skills/claude-skills` (existing Skill Runtime skills)
 *   2. `skills-main/` (official Anthropic Agent Skills)
 *
 * Only the small frontmatter is read here — never the full skill bodies or
 * reference files. Anthropic skills receive routing overrides from
 * `skills-main-routing.ts`.
 */
export async function getSkillRegistry(): Promise<SkillMeta[]> {
  if (registryCache) return registryCache
  if (registryUnavailable) return []

  try {
    const skills = await scanRoot(CLAUDE_SKILLS_ROOT)
    const skillsMainRoot = resolveSkillsMainRoot()
    if (skillsMainRoot) {
      skills.push(...(await scanRoot(skillsMainRoot)))
    }

    registryCache = skills
    return skills
  } catch {
    // If a skills directory is missing (e.g. not deployed), degrade silently.
    registryUnavailable = true
    return []
  }
}

/** Test/utility helper to reset the in-memory cache. */
export function resetSkillRegistryCache(): void {
  registryCache = null
  registryUnavailable = false
}
