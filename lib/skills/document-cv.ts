/**
 * Semantic premium CV / résumé renderer — Design System V4 (composition A4).
 *
 * A CV must be *composed*, not transcribed. This module turns whatever the model
 * sent (structured `spec.cv` fields OR a Markdown body) into a structured
 * {@link CvModel}, then renders that model into a dedicated, print-safe HTML/CSS
 * document with its own design system: asymmetric sidebar + main column, an
 * editorial typography scale, experience metrics rendered as visual stats, and
 * project cards that grow when richer data exists.
 *
 * V4 raises the visual density and vertical rhythm so the composed content
 * fills the A4 page naturally (no invented content, no artificial stretch).
 *
 * The Playwright pipeline simply prints the resulting HTML to PDF.
 */

import { buildMarkdownSource } from './document-runtime'

export interface CvExperience {
  role: string
  company?: string
  period?: string
  location?: string
  highlights: string[]
}

export interface CvSkillGroup {
  category: string
  skills: string[]
}

export interface CvEducation {
  program?: string
  institution?: string
  meta?: string
}

export interface CvProject {
  name: string
  description?: string
  role?: string
  metric?: string
  tech?: string
}

export interface CvModel {
  name?: string
  title?: string
  contact: string[]
  about?: string
  experience: CvExperience[]
  skills: CvSkillGroup[]
  education: CvEducation[]
  projects: CvProject[]
  languages: string[]
  footer?: string
}

type SectionKind =
  | 'about'
  | 'experience'
  | 'skills'
  | 'education'
  | 'projects'
  | 'languages'

const SECTIONS: [RegExp, SectionKind][] = [
  [/profil|about|pr.?sentation|r.?sum.?|propos/i, 'about'],
  [/exp.?rience|experience|parcours|emploi|career/i, 'experience'],
  [/comp.?tence|skill|aptitude|savoir|expertise/i, 'skills'],
  [/formation|education|.?tude|etudes|scolarit/i, 'education'],
  [/projet|r.?alisation|portfolio|works/i, 'projects'],
  [/langue|language/i, 'languages']
]

function sectionKind(s: string): SectionKind | null {
  for (const [re, kind] of SECTIONS) if (re.test(s)) return kind
  return null
}

function isSection(s: string): boolean {
  return sectionKind(s) !== null
}

/** Split "A — B" (em/en/dash or explicit separator) into a head + tail. */
function splitPair(s: string, sep?: string): [string, string?] {
  const re = sep ? new RegExp(`\\s*${sep}\\s*`) : /\s*[—–-]\s+/
  const parts = s.split(re)
  if (parts.length >= 2)
    return [
      parts[0].trim(),
      parts
        .slice(1)
        .join(sep ?? ' - ')
        .trim()
    ]
  return [s.trim()]
}

/** Split a skills / projects / languages line into discrete items. */
function splitSkills(s: string): string[] {
  return s
    .split(/\s*[·•,/|]\s*|\n/)
    .map(x => x.trim())
    .filter(Boolean)
}

function splitContact(s: string): string[] {
  return s
    .split(/\s*[·|]\s*|\s*,\s*/)
    .map(x => x.trim())
    .filter(Boolean)
}

/** Extract a leading quantity/percentage as a visual stat, if present. */
function extractMetric(s: string): { value: string; label: string } | null {
  const t = s.trim()
  const m = /^([+\-]?\d[\d\s]*\+?%?)\s*(?:[-–—:]\s*)?(.+)$/.exec(t)
  if (m && /\d/.test(m[1])) {
    const label = m[2].replace(/^(de|des|du|la|le|les|of|for)\s+/i, '').trim()
    return { value: m[1].trim(), label }
  }
  return null
}

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Build a structured CV model from a document spec. */
export function buildCvModel(spec: Record<string, unknown>): CvModel {
  const model: CvModel = {
    contact: [],
    experience: [],
    skills: [],
    education: [],
    projects: [],
    languages: []
  }

  const md = buildMarkdownSource(spec)
  if (md.trim()) parseCvInto(md, model)

  const cv = spec.cv as Record<string, unknown> | undefined
  if (cv) {
    if (typeof cv.name === 'string') model.name = cv.name.trim()
    if (typeof cv.title === 'string') model.title = cv.title.trim()
    if (Array.isArray(cv.contact))
      model.contact = cv.contact.filter(x => typeof x === 'string').map(String)
    if (typeof cv.about === 'string') model.about = cv.about
    if (Array.isArray(cv.experience))
      model.experience = cv.experience.map((e: Record<string, unknown>) => ({
        role: String(e.role ?? ''),
        company: e.company ? String(e.company) : undefined,
        period: e.period ? String(e.period) : undefined,
        location: e.location ? String(e.location) : undefined,
        highlights: Array.isArray(e.highlights) ? e.highlights.map(String) : []
      }))
    if (Array.isArray(cv.skills))
      model.skills = cv.skills.map((g: Record<string, unknown>) => ({
        category: String(g.category ?? ''),
        skills: Array.isArray(g.skills) ? g.skills.map(String) : []
      }))
    if (Array.isArray(cv.education))
      model.education = cv.education.map((e: Record<string, unknown>) => ({
        program: e.program ? String(e.program) : undefined,
        institution: e.institution ? String(e.institution) : undefined,
        meta: e.meta ? String(e.meta) : undefined
      }))
    if (Array.isArray(cv.projects))
      model.projects = cv.projects.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? p ?? ''),
        description: p.description ? String(p.description) : undefined,
        role: p.role ? String(p.role) : undefined,
        metric: p.metric ? String(p.metric) : undefined,
        tech: p.tech ? String(p.tech) : undefined
      }))
    if (Array.isArray(cv.languages)) model.languages = cv.languages.map(String)
    if (typeof cv.footer === 'string') model.footer = cv.footer
  }

  return model
}

function parseCvInto(md: string, model: CvModel): void {
  type El = { t: 'h1' | 'h2' | 'h3' | 'text' | 'bullet'; s: string }
  const els: El[] = []
  const lines = md.split(/\r?\n/)
  let pendingBullets: string[] = []
  const flush = () => {
    if (pendingBullets.length) {
      els.push({ t: 'bullet', s: pendingBullets.join('\n') })
      pendingBullets = []
    }
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      els.push({ t: `h${h[1].length}` as 'h1' | 'h2' | 'h3', s: h[2].trim() })
      continue
    }
    const b = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (b) {
      pendingBullets.push(b[1].trim())
      continue
    }
    flush()
    els.push({ t: 'text', s: line.trim() })
  }
  flush()

  const h1 = els.find(e => e.t === 'h1')
  if (h1) {
    const [name, inlineTitle] = splitPair(h1.s)
    model.name = name
    if (inlineTitle && !model.title) model.title = inlineTitle
  }

  const titleH2 = els.find(e => e.t === 'h2' && !isSection(e.s))
  if (titleH2)
    model.title = [model.title, titleH2.s].filter(Boolean).join(' · ')

  let section: SectionKind | null = null
  let curExp: CvExperience | null = null
  let curSkill: CvSkillGroup | null = null
  let curEdu: CvEducation | null = null
  let curProject: CvProject | null = null
  let expMetaPending = false

  for (const e of els) {
    if (e.t === 'h2') {
      section = sectionKind(e.s)
      curExp = null
      curSkill = null
      curEdu = null
      curProject = null
      expMetaPending = false
      continue
    }
    if (section === null) {
      if (e.t === 'text') {
        if (!model.title && !/[@·|http\d{2,}]/i.test(e.s)) model.title = e.s
        else model.contact.push(...splitContact(e.s))
      }
      continue
    }
    if (e.t === 'h3') {
      if (section === 'experience') {
        const [role, company] = splitPair(e.s)
        curExp = { role, company, highlights: [] }
        model.experience.push(curExp)
        expMetaPending = true
      } else if (section === 'skills') {
        curSkill = { category: e.s, skills: [] }
        model.skills.push(curSkill)
      } else if (section === 'education') {
        curEdu = { program: e.s }
        model.education.push(curEdu)
      } else if (section === 'projects') {
        curProject = { name: e.s }
        model.projects.push(curProject)
      } else if (section === 'languages') {
        model.languages.push(...splitSkills(e.s))
      }
      continue
    }
    if (e.t === 'bullet') {
      const items = e.s
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
      if (section === 'experience' && curExp) curExp.highlights.push(...items)
      else if (section === 'skills' && curSkill) curSkill.skills.push(...items)
      else if (section === 'projects' && curProject)
        curProject.description = [curProject.description, ...items]
          .filter(Boolean)
          .join(' ')
      else if (section === 'projects')
        items.forEach(n => model.projects.push({ name: n }))
      else if (section === 'languages') model.languages.push(...items)
      else if (section === 'about')
        model.about = [model.about, items.join(' ')].filter(Boolean).join(' ')
      continue
    }
    if (e.t === 'text') {
      if (section === 'about') {
        model.about = [model.about, e.s].filter(Boolean).join('\n')
      } else if (section === 'experience' && curExp) {
        if (expMetaPending) {
          const [period, loc] = splitPair(e.s, '·')
          curExp.period = period?.trim()
          if (loc) curExp.location = loc.trim()
          expMetaPending = false
        } else {
          curExp.highlights.push(e.s)
        }
      } else if (section === 'skills' && curSkill) {
        curSkill.skills.push(...splitSkills(e.s))
      } else if (section === 'education' && curEdu) {
        const [a, b] = splitPair(e.s, '·')
        if (a && !curEdu.institution) curEdu.institution = a.trim()
        if (b) curEdu.meta = b.trim()
        else if (a && !curEdu.meta) curEdu.meta = a.trim()
      } else if (section === 'projects' && curProject) {
        curProject.description = [curProject.description, e.s]
          .filter(Boolean)
          .join(' ')
      } else if (section === 'projects') {
        splitSkills(e.s).forEach(n => model.projects.push({ name: n }))
      } else if (section === 'languages') {
        model.languages.push(...splitSkills(e.s))
      }
    }
  }
}

/**
 * CV Premium V4 — a composed, print-safe document with its own design system.
 * The accent is reserved for identity, experience indices and metrics; company
 * names, sidebar labels and rules stay ink/neutral for an editorial feel. The
 * sidebar stretches to full height and the content density / vertical rhythm
 * are tuned so the CV fills the A4 page as a deliberate composition.
 */

/** Identity block: imposing name + professional label. */
function IdentityHeader(model: CvModel): string {
  const name = model.name ? esc(model.name) : 'Votre Nom'
  const title = model.title
    ? `<div class="cv-title">${esc(model.title)}</div>`
    : ''
  return `<header class="cv-header">
    <div class="cv-name">${name}</div>
    ${title}
    <div class="cv-header-rule"></div>
  </header>`
}

/** Sidebar: contact details, stacked. */
function ContactSection(model: CvModel): string {
  if (!model.contact.length) return ''
  const rows = model.contact
    .map(c => `<div class="cv-contact-line">${esc(c)}</div>`)
    .join('')
  return `<section class="cv-side-block">
    <div class="cv-side-label">Contact</div>
    <div class="cv-contact">${rows}</div>
  </section>`
}

/** Sidebar: editorial skills (category + inline list, not chips). */
function SkillsSection(model: CvModel): string {
  if (!model.skills.length) return ''
  const groups = model.skills
    .map(g => {
      const val = g.skills.length
        ? g.skills.map(esc).join(' · ')
        : esc(g.category)
      return `<div class="cv-skill">
        <div class="cv-skill-cat">${esc(g.category)}</div>
        <div class="cv-skill-val">${val}</div>
      </div>`
    })
    .join('')
  return `<section class="cv-side-block">
    <div class="cv-side-label">Compétences</div>
    ${groups}
  </section>`
}

/** Sidebar: compact education (ink, not accent). */
function EducationSection(model: CvModel): string {
  if (!model.education.length) return ''
  const items = model.education
    .map(e => {
      const inst = e.institution
        ? `<div class="cv-edu-inst">${esc(e.institution)}</div>`
        : ''
      const meta = e.meta ? `<div class="cv-edu-meta">${esc(e.meta)}</div>` : ''
      return `<div class="cv-edu">
        <div class="cv-edu-prog">${esc(e.program ?? '')}</div>
        ${inst}${meta}
      </div>`
    })
    .join('')
  return `<section class="cv-side-block">
    <div class="cv-side-label">Formation</div>
    ${items}
  </section>`
}

/** Sidebar: languages. */
function LanguagesSection(model: CvModel): string {
  if (!model.languages.length) return ''
  return `<section class="cv-side-block">
    <div class="cv-side-label">Langues</div>
    <div class="cv-langs">${model.languages.map(l => `<span class="cv-lang">${esc(l)}</span>`).join('<span class="cv-lang-sep">·</span>')}</div>
  </section>`
}

/** Main: profile summary with an editorial (short) divider. */
function AboutSection(model: CvModel): string {
  if (!model.about) return ''
  return `<section class="cv-main-block">
    <div class="cv-main-label">Profil</div>
    <div class="cv-main-rule"></div>
    <p class="cv-about">${esc(model.about).replace(/\n/g, '<br />')}</p>
  </section>`
}

/** Main: one experience entry — numbered, metrics as visual stats. */
function ExperienceItem(exp: CvExperience, index: number): string {
  const no = String(index + 1).padStart(2, '0')
  const meta = `${exp.company ? esc(exp.company) : ''}${exp.company && exp.location ? ' · ' : ''}${
    exp.location ? esc(exp.location) : ''
  }`
  const stats: { value: string; label: string }[] = []
  const bullets: string[] = []
  for (const h of exp.highlights) {
    const m = extractMetric(h)
    if (m) stats.push(m)
    else bullets.push(h)
  }
  const statsHtml = stats.length
    ? `<div class="cv-stats">${stats
        .map(
          s =>
            `<div class="cv-stat"><span class="cv-stat-val">${esc(s.value)}</span><span class="cv-stat-label">${esc(s.label)}</span></div>`
        )
        .join('')}</div>`
    : ''
  const bulletsHtml = bullets.length
    ? `<ul class="cv-highlights">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    : ''
  return `<div class="cv-exp">
    <div class="cv-exp-no">${no}</div>
    <div class="cv-exp-body">
      <div class="cv-exp-top">
        <span class="cv-role">${esc(exp.role)}</span>
        ${exp.period ? `<span class="cv-period">${esc(exp.period)}</span>` : ''}
      </div>
      ${meta ? `<div class="cv-company">${meta}</div>` : ''}
      ${statsHtml}
      ${bulletsHtml}
    </div>
  </div>`
}

/** Main: experience timeline. */
function ExperienceTimeline(model: CvModel): string {
  if (!model.experience.length) return ''
  return `<section class="cv-main-block">
    <div class="cv-main-label">Expérience</div>
    <div class="cv-main-rule"></div>
    ${model.experience.map((e, i) => ExperienceItem(e, i)).join('')}
  </section>`
}

/** Main: project cards — grow with role / description / metric / tech. */
function ProjectsGrid(model: CvModel): string {
  if (!model.projects.length) return ''
  const cards = model.projects
    .map(p => {
      const hasDetail = p.role || p.description || p.metric || p.tech
      const role = p.role
        ? `<div class="cv-proj-role">${esc(p.role)}</div>`
        : ''
      const desc = p.description
        ? `<div class="cv-proj-desc">${esc(p.description)}</div>`
        : ''
      const metric = p.metric
        ? `<div class="cv-proj-metric">${esc(p.metric)}</div>`
        : ''
      const tech = p.tech
        ? `<div class="cv-proj-tech">${esc(p.tech)}</div>`
        : ''
      const rule = !hasDetail ? `<div class="cv-proj-rule"></div>` : ''
      return `<div class="cv-proj">
        <div class="cv-proj-name">${esc(p.name)}</div>
        ${role}${desc}${metric}${tech}${rule}
      </div>`
    })
    .join('')
  return `<section class="cv-main-block">
    <div class="cv-main-label">Projets</div>
    <div class="cv-main-rule"></div>
    <div class="cv-proj-grid">${cards}</div>
  </section>`
}

/** Closing line. */
function CvFooter(model: CvModel): string {
  if (!model.footer) return ''
  return `<footer class="cv-footer">${esc(model.footer)}</footer>`
}

/** Render a structured CV model into a complete, print-safe HTML doc. */
export function renderCvHtml(model: CvModel, accent = '#2563eb'): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${model.name ? esc(model.name) : 'CV'}</title>
<style>
  :root {
    --accent: ${accent};
    --ink: #15161a;
    --muted: #6b6f76;
    --soft: #9a9ea6;
    --border: #e6e7ec;
    --surface: #f4f5f8;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px; line-height: 1.6;
    background: #fff;
  }
  .cv { max-width: 790px; margin: 0 auto; padding: 32px 44px 24px; }

  /* Pagination control: keep every logical block on one page. */
  .cv-header, .cv-side-block, .cv-main-block, .cv-exp, .cv-proj { break-inside: avoid; }

  /* ---- Identity header ---- */
  .cv-header { margin-bottom: 32px; }
  .cv-name { font-size: 46px; font-weight: 800; letter-spacing: -0.6px; line-height: 1; color: var(--ink); }
  .cv-title { font-size: 14px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 2.4px; margin-top: 10px; }
  .cv-header-rule { height: 4px; width: 64px; background: var(--accent); border-radius: 2px; margin-top: 16px; }

  /* ---- Body: asymmetric sidebar + main ---- */
  .cv-body { display: grid; grid-template-columns: 31% 1fr; gap: 34px; align-items: stretch; }

  .cv-side { background: var(--surface); border-radius: 14px; padding: 30px 22px; height: 100%; }
  .cv-side-block { margin-bottom: 24px; }
  .cv-side-block:last-child { margin-bottom: 0; }
  .cv-side-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.8px; color: var(--ink); font-weight: 700; margin-bottom: 13px; display: flex; align-items: center; gap: 7px; }
  .cv-side-label::before { content: ""; width: 6px; height: 6px; border-radius: 1px; background: var(--accent); display: inline-block; }

  .cv-contact-line { font-size: 12px; color: var(--muted); margin: 4px 0; word-break: break-word; }

  .cv-skill { margin-bottom: 16px; }
  .cv-skill:last-child { margin-bottom: 0; }
  .cv-skill-cat { font-size: 11px; font-weight: 700; color: var(--ink); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .cv-skill-val { font-size: 12.5px; color: var(--muted); line-height: 1.7; }

  .cv-edu { margin-bottom: 16px; }
  .cv-edu:last-child { margin-bottom: 0; }
  .cv-edu-prog { font-size: 12.5px; font-weight: 700; color: var(--ink); }
  .cv-edu-inst { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .cv-edu-meta { font-size: 11.5px; color: var(--soft); margin-top: 2px; }

  .cv-langs { font-size: 12px; color: var(--muted); }
  .cv-lang-sep { color: var(--soft); margin: 0 6px; }

  /* ---- Main column ---- */
  .cv-main-label { font-size: 12.5px; text-transform: uppercase; letter-spacing: 2px; color: var(--ink); font-weight: 700; margin-bottom: 10px; }
  .cv-main-rule { width: 36px; height: 2px; background: var(--accent); border-radius: 1px; margin-bottom: 20px; }
  .cv-main-block { margin-bottom: 30px; }

  .cv-about { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.9; }

  .cv-exp { display: flex; gap: 18px; margin-bottom: 28px; }
  .cv-exp:last-child { margin-bottom: 0; }
  .cv-exp-no { font-size: 14px; font-weight: 800; color: var(--accent); padding-top: 3px; min-width: 20px; }
  .cv-exp-body { flex: 1; }
  .cv-exp-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .cv-role { font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: 0.2px; }
  .cv-period { font-size: 12px; color: var(--soft); font-weight: 600; white-space: nowrap; }
  .cv-company { font-size: 12.5px; color: var(--muted); font-weight: 600; margin-top: 3px; }
  .cv-stats { display: flex; flex-wrap: wrap; gap: 28px; margin: 14px 0 4px; }
  .cv-stat { display: flex; flex-direction: column; }
  .cv-stat-val { font-size: 24px; font-weight: 800; color: var(--accent); line-height: 1; letter-spacing: -0.3px; }
  .cv-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); margin-top: 6px; }
  .cv-highlights { margin: 14px 0 0; padding-left: 18px; }
  .cv-highlights li { font-size: 12px; color: var(--muted); margin: 4px 0; line-height: 1.6; }

  .cv-proj-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .cv-proj { border: 1px solid var(--border); border-radius: 12px; padding: 24px 24px; background: #fff; min-height: 92px; }
  .cv-proj-name { font-size: 14.5px; font-weight: 700; color: var(--ink); letter-spacing: 0.4px; text-transform: uppercase; }
  .cv-proj-role { font-size: 11.5px; color: var(--accent); font-weight: 600; margin-top: 5px; }
  .cv-proj-desc { font-size: 11.5px; color: var(--muted); margin-top: 7px; line-height: 1.6; }
  .cv-proj-metric { font-size: 15.5px; font-weight: 700; color: var(--ink); margin-top: 8px; }
  .cv-proj-tech { font-size: 11px; color: var(--soft); margin-top: 5px; }
  .cv-proj-rule { width: 26px; height: 2px; background: var(--accent); border-radius: 1px; margin-top: 10px; }

  .cv-footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--border); text-align: center; font-size: 10px; color: var(--soft); }
</style>
</head>
<body>
  <div class="cv">
    ${IdentityHeader(model)}
    <div class="cv-body">
      <aside class="cv-side">
        ${ContactSection(model)}
        ${SkillsSection(model)}
        ${EducationSection(model)}
        ${LanguagesSection(model)}
      </aside>
      <main class="cv-main">
        ${AboutSection(model)}
        ${ExperienceTimeline(model)}
        ${ProjectsGrid(model)}
      </main>
    </div>
    ${CvFooter(model)}
  </div>
</body>
</html>`
}
