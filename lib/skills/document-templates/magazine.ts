import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
body { font-family: Georgia, "Times New Roman", serif; font-size: 15px; line-height: 1.8; color: #1a1a1a; }
h1 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 2.4em; line-height: 1.1; margin: 0.4em 0 0.2em; }
h1 + p { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.8em; font-weight: 700; margin-top: 0; }
h2 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 1.3em; margin: 1.6em 0 0.4em; color: #0b0b0f; }
p:first-of-type::first-letter { float: left; font-size: 3.4em; line-height: 0.8; padding: 0.05em 0.1em 0 0; color: var(--accent); font-weight: 700; }
code { background: #efefef; }
pre { background: #1c1c1c; }
`

const template: TemplateDef = { label: 'Magazine', css }
export default template
