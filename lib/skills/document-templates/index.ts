import brochure from './brochure'
import certificate from './certificate'
import cv from './cv'
import defaultTpl from './default'
import invoice from './invoice'
import magazine from './magazine'
import minimal from './minimal'
import portfolio from './portfolio'
import proposal from './proposal'
import report from './report'
import resume from './resume'
import type { TemplateDef } from './types'

/**
 * Template registry. Each document type (cv, invoice, report, certificate, …)
 * is its own module under this folder, so the AI Builder can add new layouts
 * simply by dropping a file here and registering it below.
 */
export const TEMPLATES: Record<string, TemplateDef> = {
  default: defaultTpl,
  minimal,
  report,
  cv,
  resume,
  portfolio,
  invoice,
  brochure,
  magazine,
  certificate,
  proposal
}

export function getTemplate(name: string): TemplateDef {
  return TEMPLATES[name] ?? TEMPLATES.default
}

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES)
}
