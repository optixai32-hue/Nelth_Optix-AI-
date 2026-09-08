import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
main.tpl-certificate { max-width: 720px; border: 3px double var(--accent); padding: 48px 40px; margin-top: 24px; }
h1 { text-align: center; font-size: 2.4em; color: #0b0b0f; margin: 0.3em 0; }
h1 + p { text-align: center; color: #555; font-style: italic; }
h2 { text-align: center; color: var(--accent); text-transform: uppercase; letter-spacing: 0.15em; font-size: 0.9em; margin: 1.4em 0 0.4em; }
`

const template: TemplateDef = { label: 'Certificate', css }
export default template
