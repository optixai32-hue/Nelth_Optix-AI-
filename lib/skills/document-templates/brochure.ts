import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
main { max-width: 780px; }
h1 { text-align: center; font-size: 2.6em; color: #0b0b0f; margin: 1em 0 0.3em; }
h2 { text-align: center; font-size: 1.5em; color: var(--accent); margin: 1.4em 0 0.4em; }
p { font-size: 1.05em; line-height: 1.8; }
blockquote { background: color-mix(in srgb, var(--accent) 8%, #fff); border-left: 4px solid var(--accent); }
`

const template: TemplateDef = { label: 'Brochure', css }
export default template
