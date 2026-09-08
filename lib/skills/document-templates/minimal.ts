import { BASE_CSS } from './shared'
import type { TemplateDef } from './types'

const css = (accent: string) =>
  BASE_CSS +
  `
body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: 14px; line-height: 1.7; }
h1, h2, h3, h4 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #000; margin: 1.4em 0 0.5em; font-weight: 700; }
h1 { font-size: 1.9em; }
h2 { font-size: 1.4em; }
h3 { font-size: 1.15em; }
a { color: #111; text-decoration: underline; }
code { background: #f2f2f2; }
pre { background: #f2f2f2; }
blockquote { border-left: 3px solid #ccc; color: #444; font-style: italic; background: transparent; }
hr { border-top: 1px solid #ccc; }
th, td { border: 1px solid #ccc; }
thead th { background: #f2f2f2; }
`

const template: TemplateDef = { label: 'Minimal', css }
export default template
