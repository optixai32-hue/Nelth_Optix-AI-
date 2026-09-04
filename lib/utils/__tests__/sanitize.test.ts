import { describe, expect, it } from 'vitest'

import { stripFakeToolCallXml } from '@/lib/utils/message-utils'

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
