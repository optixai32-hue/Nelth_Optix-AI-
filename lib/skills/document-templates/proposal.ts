import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
h1 { font-size: 2.2em; color: #0b0b0f; margin: 0.3em 0 0.3em; border-bottom: 3px solid var(--accent); padding-bottom: 0.2em; }
h2 { font-size: 1.3em; color: var(--accent); margin: 1.6em 0 0.4em; }
h3 { color: #222; }
thead th { background: var(--accent); color: #fff; }
blockquote { border-left: 4px solid var(--accent); }
`

const template: TemplateDef = { label: 'Proposal', css }
export default template
