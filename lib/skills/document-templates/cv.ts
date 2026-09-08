import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
main { max-width: 820px; }
h1 { font-size: 2.6em; margin: 0.4em 0 0.05em; color: #0b0b0f; letter-spacing: -0.02em; }
h1 + p { color: var(--accent); font-weight: 600; margin-top: 0; font-size: 1.05em; }
h2 { text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.85em; font-weight: 700; color: var(--accent); border: none; margin: 1.8em 0 0.6em; border-left: 3px solid var(--accent); padding-left: 0.6em; }
h3 { font-size: 1.05em; margin: 0.9em 0 0.1em; color: #0b0b0f; }
h4, h5, h6 { font-size: 0.95em; color: #5b5b66; margin: 0.4em 0 0.1em; }
`

const template: TemplateDef = { label: 'CV', css }
export default template
