import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
h1 { font-size: 2.4em; margin: 0.4em 0 0.2em; color: #0b0b0f; }
h2 { font-size: 1.4em; color: var(--accent); margin: 1.4em 0 0.4em; }
ul li::marker { color: var(--accent); }
a { border-bottom: 1px solid var(--accent); }
`

const template: TemplateDef = { label: 'Portfolio', css }
export default template
