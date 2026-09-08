import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
main { border-top: 6px solid var(--accent); padding-top: 24px; }
h1 { font-size: 2em; color: #0b0b0f; margin: 0.2em 0 0.4em; }
h2 { font-size: 1.2em; color: #333; margin: 1.4em 0 0.4em; }
thead th { background: var(--accent); color: #fff; }
table { font-size: 0.95em; }
`

const template: TemplateDef = { label: 'Invoice', css }
export default template
