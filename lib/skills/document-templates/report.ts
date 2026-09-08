import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
h1 { text-align: center; font-size: 2.3em; margin: 1.2em 0 0.2em; color: #0b0b0f; }
h1 + p { text-align: center; color: var(--accent); font-weight: 600; margin-top: 0; }
h2 { font-size: 1.45em; margin: 1.8em 0 0.5em; padding-bottom: 0.25em; border-bottom: 2px solid var(--accent); color: #0b0b0f; }
h3 { font-size: 1.15em; color: #222; }
p { text-align: justify; }
thead th { background: var(--accent); color: #fff; }
`

const template: TemplateDef = { label: 'Report', css }
export default template
