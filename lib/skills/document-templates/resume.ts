import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
main { max-width: 820px; font-size: 13.5px; }
h1 { font-size: 2.1em; margin: 0.3em 0; color: #0b0b0f; }
h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); border-bottom: 1px solid var(--accent); padding-bottom: 0.2em; margin: 1.4em 0 0.5em; }
h3 { font-size: 1em; margin: 0.6em 0 0.1em; color: #0b0b0f; }
ul { margin: 0.4em 0; }
li { margin: 0.15em 0; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; }
`

const template: TemplateDef = { label: 'Resume', css }
export default template
