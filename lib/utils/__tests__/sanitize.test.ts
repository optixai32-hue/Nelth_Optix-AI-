import { describe, expect, it } from 'vitest'

import {
  extractFakeSearchQuery,
  StreamTextSanitizer,
  stripFakeToolCallXml
} from '@/lib/utils/message-utils'

describe('stripFakeToolCallXml', () => {
  it('strips closed fake tool blocks', () => {
    const text =
      'Answer start.\n<tool_call name="search">{"query":"x"}</tool_call>\nAnswer end.'
    const result = stripFakeToolCallXml(text)
    expect(result).toContain('Answer start.')
    expect(result).toContain('Answer end.')
    expect(result).not.toContain('tool_call')
  })

  it('strips an unclosed tool_call to the end (unambiguous fake syntax)', () => {
    const text = 'Answer start.\n<tool_call>{"query":"x"}'
    expect(stripFakeToolCallXml(text)).toBe('Answer start.')
  })

  it('strips <search"> fake tool call', () => {
    const text =
      '<search"> Mickael président Madagascar président de Madagascar actuel 2026\nVoici les faits.'
    const result = stripFakeToolCallXml(text)
    expect(result).not.toContain('search">')
    expect(result).not.toContain('Mickael président Madagascar')
    expect(result).toContain('Voici les faits.')
  })

  it('preserves legitimate prose mentioning <function>', () => {
    const text =
      'In JavaScript, the <function> keyword declares a reusable block of code.'
    expect(stripFakeToolCallXml(text)).toBe(text)
  })

  it('preserves an unclosed bare <invoke> tag in prose', () => {
    const text = 'Call <invoke> to run it and see what happens next.'
    expect(stripFakeToolCallXml(text)).toBe(text)
  })

  it('still strips attribute-carrying fake calls even when unclosed', () => {
    const text = 'Answer.\n<invoke name="search">{"query":"x"}'
    const result = stripFakeToolCallXml(text)
    expect(result).toBe('Answer.')
  })

  it('preserves spaces at chunk edges (no word gluing)', () => {
    expect(stripFakeToolCallXml('hello <br/> world')).toBe('hello <br/> world')
    expect(stripFakeToolCallXml(' leading and trailing ')).toBe(
      ' leading and trailing '
    )
  })
})

describe('extractFakeSearchQuery', () => {
  it('extracts query from <search"> format', () => {
    const text =
      '<search"> Mickael président Madagascar président de Madagascar actuel 2026\n'
    expect(extractFakeSearchQuery(text)).toBe(
      'Mickael président Madagascar président de Madagascar actuel 2026'
    )
  })

  it('extracts query from <search query="..."> format', () => {
    const text = '<search query="président actuel madagascar">'
    expect(extractFakeSearchQuery(text)).toBe('président actuel madagascar')
  })

  it('extracts query from <search>...</search> format', () => {
    const text = '<search>qui est le président de Madagascar</search>'
    expect(extractFakeSearchQuery(text)).toBe('qui est le président de Madagascar')
  })

  it('returns null when no fake search exists', () => {
    expect(extractFakeSearchQuery('Bonjour tout le monde !')).toBeNull()
  })
})

describe('StreamTextSanitizer with <search">', () => {
  it('suppresses streaming of <search"> fake call', () => {
    const sanitizer = new StreamTextSanitizer()
    const chunk1 = sanitizer.process('<search')
    const chunk2 = sanitizer.process('"> Mickael president Madagascar')
    const remaining = sanitizer.flush()

    expect(chunk1).toBe('')
    expect(chunk2).toBe('')
    expect(remaining).not.toContain('<search')
  })
})
