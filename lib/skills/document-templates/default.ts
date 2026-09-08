import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
h1, h2, h3, h4, h5, h6 { line-height: 1.25; color: #0b0b0f; margin: 1.6em 0 0.6em; font-weight: 700; }
h1 { font-size: 2em; letter-spacing: -0.02em; border-bottom: 2px solid var(--accent); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #e4e4ea; padding-bottom: 0.25em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.05em; }
h5, h6 { font-size: 0.95em; color: #5b5b66; }
`

const template: TemplateDef = { label: 'Default', css }
export default template
