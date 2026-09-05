import { describe, expect, it } from 'vitest'

import { stripMarkdownForSpeech } from '../speech-text'

describe('stripMarkdownForSpeech', () => {
  it('drops code blocks but keeps inline code content', () => {
    const out = stripMarkdownForSpeech(
      'Voici le code :\n```js\nconst a = 1\n```\nUtilise `npm run dev`.'
    )
    expect(out).not.toContain('const a = 1')
    expect(out).toContain('npm run dev')
  })

  it('flattens tables, links, headings and lists', () => {
    const out = stripMarkdownForSpeech(
      '# Résumé\n- [Facture](https://x.com/f) : 42€\n| A | B |\n|---|---|\n| 1 | 2 |'
    )
    expect(out).toContain('Résumé')
    expect(out).toContain('Facture')
    expect(out).not.toContain('https://')
    expect(out).not.toContain('#')
    expect(out).not.toContain('|')
  })

  it('removes emojis and bare URLs', () => {
    const out = stripMarkdownForSpeech(
      '📬 Vos mails 🎉 voir https://example.com/a pour détails'
    )
    expect(out).not.toContain('📬')
    expect(out).not.toContain('https://')
    expect(out).toContain('Vos mails')
  })

  it('caps length at 2000 chars', () => {
    expect(stripMarkdownForSpeech('a'.repeat(5000))).toHaveLength(2000)
  })

  it('returns empty for empty input', () => {
    expect(stripMarkdownForSpeech('')).toBe('')
  })
})
