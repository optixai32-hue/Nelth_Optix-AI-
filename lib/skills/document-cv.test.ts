import { describe, expect, it } from 'vitest'

import { buildCvModel, renderCvHtml } from './document-cv'

const SAMPLE = `# Alex Martin

## Product Designer · Concepteur Produit

Paris · alexmartin.dev · alex@martin.dev · +33 6 12 34 56 78

## Profil

Créatif polyvalent avec 6+ ans d'expérience en conception de produits numériques.

## Expérience

### Lead Product Designer — Nova Studio

2022 — Présent · Paris

- Direction artistique de 12+ produits SaaS
- +40 % de conversion moyenne

### Full-Stack Developer — Lumio Tech

2019 — 2022 · Paris

- 20+ applications React / Node

## Compétences

### Design

Figma · Framer

### Frontend

React · TypeScript

### Backend

Node · Postgres

### Autres

Git · Docker

## Formation

### Master — Design & Innovation

École Créative · 2019

### Licence — Informatique

Sorbonne · 2017

## Projets

Flux · Aurora · Pulse

## Langues

Français (natif) · Anglais (courant)`

describe('buildCvModel', () => {
  it('parses a realistic Markdown CV into semantic components', () => {
    const m = buildCvModel({ template: 'cv', markdown: SAMPLE })
    expect(m.name).toBe('Alex Martin')
    expect(m.title).toMatch(/Product Designer/)
    expect(m.contact).toContain('Paris')
    expect(m.contact.some(c => c.includes('alexmartin.dev'))).toBe(true)
    expect(m.about).toMatch(/Créatif polyvalent/)

    expect(m.experience).toHaveLength(2)
    expect(m.experience[0].role).toBe('Lead Product Designer')
    expect(m.experience[0].company).toBe('Nova Studio')
    expect(m.experience[0].period).toMatch(/2022/)
    expect(m.experience[0].location).toBe('Paris')
    expect(
      m.experience[0].highlights.some(h =>
        /Direction artistique de 12\+ produits/.test(h)
      )
    ).toBe(true)

    expect(m.skills[0].category).toBe('Design')
    expect(m.skills[0].skills).toContain('Figma')

    expect(m.education).toHaveLength(2)
    expect(m.education[0].program).toMatch(/Master/)
    expect(m.education[0].institution).toBe('École Créative')
    expect(m.education[0].meta).toBe('2019')

    expect(m.projects.some(p => p.name === 'Flux')).toBe(true)
    expect(m.languages.some(l => /Français/.test(l))).toBe(true)
  })

  it('accepts structured cv fields directly', () => {
    const m = buildCvModel({
      template: 'cv',
      cv: {
        name: 'Jane Doe',
        title: 'Engineer',
        experience: [
          {
            role: 'CTO',
            company: 'Acme',
            period: '2020—',
            highlights: ['Grew team']
          }
        ],
        skills: [{ category: 'Lang', skills: ['Go'] }]
      }
    })
    expect(m.name).toBe('Jane Doe')
    expect(m.experience[0].role).toBe('CTO')
    expect(m.skills[0].skills).toContain('Go')
  })
})

describe('renderCvHtml', () => {
  const m = buildCvModel({ template: 'cv', markdown: SAMPLE })

  it('produces a composed CV, never a linear Markdown dump', () => {
    const html = renderCvHtml(m, '#2563eb')
    // No raw Markdown structure leaked into the PDF.
    expect(html).not.toMatch(/^#\s/m)
    // Real composition blocks present.
    expect(html).toMatch(/Alex Martin/)
    expect(html).toMatch(/Lead Product Designer/)
    expect(html).toMatch(/Expérience/)
    expect(html).toMatch(/Compétences/)
    expect(html).toMatch(/Flux/)
    expect(html).toMatch(/Français/)
  })
})
