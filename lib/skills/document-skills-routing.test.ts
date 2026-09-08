import { describe, expect, it } from 'vitest'

import { buildSkillContext } from './build-skill-context'
import { extractAttachmentFormats, formatFromName } from './document-runtime'
import { getSkillRegistry } from './registry'
import { routeSkills } from './router'

/**
 * REAL integration between the Skill Router and the document Anthropic skills.
 * Proves that uploading a document (pdf/docx/xlsx/pptx) actually activates the
 * matching skill and loads its real SKILL.md — no second router, no placeholder.
 */

describe('Document skills are registered', () => {
  it('discovers the four document skills in the registry', async () => {
    const registry = await getSkillRegistry()
    for (const slug of ['pdf', 'docx', 'xlsx', 'pptx']) {
      const meta = registry.find(s => s.slug === slug)
      expect(meta, `skill ${slug} should be registered`).toBeDefined()
      expect(meta!.skillDir).toBeTruthy()
    }
  })
})

describe('Attachment format detection', () => {
  it('extracts slugs from message file parts', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      {
        type: 'file',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'data.xlsx'
      },
      {
        type: 'file',
        mimeType: 'application/pdf',
        filename: 'report.pdf'
      }
    ]
    const fmts = extractAttachmentFormats(parts as never)
    expect(fmts).toContain('xlsx')
    expect(fmts).toContain('pdf')
    expect(fmts).not.toContain('docx')
  })

  it('falls back to filename when MIME is missing', () => {
    const fmts = extractAttachmentFormats([
      { type: 'file', filename: 'deck.pptx' }
    ] as never)
    expect(fmts).toEqual(['pptx'])
  })
})

describe('Skill Router — attachment-driven activation (no trigger needed)', () => {
  it('activates the PDF skill for an uploaded PDF even with an empty query', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('', registry, ['pdf'])
    expect(selected.map(s => s.slug)).toContain('pdf')
  })

  it('activates docx + xlsx for two attached documents', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('', registry, ['docx', 'xlsx'])
    const slugs = selected.map(s => s.slug)
    expect(slugs).toContain('docx')
    expect(slugs).toContain('xlsx')
  })

  it('does not activate document skills for an image-only attachment', async () => {
    const registry = await getSkillRegistry()
    const selected = routeSkills('', registry, ['png'])
    const slugs = selected.map(s => s.slug)
    expect(slugs).not.toContain('pdf')
    expect(slugs).not.toContain('docx')
    expect(slugs).not.toContain('xlsx')
    expect(slugs).not.toContain('pptx')
  })
})

describe('buildSkillContext — document skill is ACTIVATED and SKILL.md loaded', () => {
  it('TEST pdf upload: activates pdf skill and injects its real SKILL.md', async () => {
    const result = await buildSkillContext('Resume ce PDF', 'minimal', ['pdf'])
    const slugs = result.activated.map(a => a.slug)
    expect(slugs).toContain('pdf')
    // The real SKILL.md body is injected, not a generic placeholder.
    expect(result.context).toContain(
      'SKILL INSTRUCTIONS — loaded from SKILL.md, apply these directly:'
    )
    expect(result.debug?.skillMdLoaded).toBe(true)
    expect(result.states?.['pdf']).toBe('active')
  })

  it('TEST xlsx upload: activates xlsx skill and loads SKILL.md', async () => {
    const result = await buildSkillContext('Analyse ce fichier', 'minimal', [
      'xlsx'
    ])
    expect(result.activated.map(a => a.slug)).toContain('xlsx')
    expect(result.debug?.loaded).toContain('xlsx')
  })

  it('TEST pptx upload: activates pptx skill and loads SKILL.md', async () => {
    const result = await buildSkillContext('Présente ça', 'minimal', ['pptx'])
    expect(result.activated.map(a => a.slug)).toContain('pptx')
    expect(result.debug?.loaded).toContain('pptx')
  })

  it('TEST docx upload: activates docx skill and loads SKILL.md', async () => {
    const result = await buildSkillContext('Résume ce doc', 'minimal', ['docx'])
    expect(result.activated.map(a => a.slug)).toContain('docx')
    expect(result.debug?.loaded).toContain('docx')
  })

  it('formatFromName keeps working for attachment mapping', () => {
    expect(formatFromName('a.DOCX')).toBe('docx')
    expect(formatFromName('b.XLSX')).toBe('xlsx')
  })
})
