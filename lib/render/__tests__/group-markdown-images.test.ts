import { describe, expect, it } from 'vitest'

import { groupMarkdownImages } from '@/lib/render/group-markdown-images'
import { createSpecFenceEvaluator } from '@/lib/render/spec-fence'

describe('groupMarkdownImages', () => {
  it('leaves text without images untouched', () => {
    const text = 'Hello **world**\n\nNo images here.'
    expect(groupMarkdownImages(text)).toBe(text)
  })

  it('leaves a single image as Markdown', () => {
    const text = 'Look:\n\n![solo](https://a.test/1.jpg)\n\nDone.'
    expect(groupMarkdownImages(text)).toBe(text)
  })

  it('groups consecutive images into a spec gallery in order', () => {
    const text = [
      'Voici :',
      '',
      '![First](https://a.test/1.jpg)',
      '![Second](https://a.test/2.jpg)',
      '![Third](https://a.test/3.jpg)',
      '',
      'Sources :',
      'https://a.test/1.jpg'
    ].join('\n')
    const out = groupMarkdownImages(text)
    expect(out).toContain('```spec')
    expect(out).toContain('"columns":3')
    expect(out).not.toContain('![First]')
    // Order preserved: img1 before img2 before img3.
    const i1 = out.indexOf('gallery1img1')
    const i2 = out.indexOf('gallery1img2')
    const i3 = out.indexOf('gallery1img3')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    // Surrounding text untouched.
    expect(out).toContain('Voici :')
    expect(out).toContain('Sources :')
  })

  it('does not touch images inside fenced code blocks', () => {
    const text = '```\n![code](https://a.test/1.jpg)\n```'
    expect(groupMarkdownImages(text)).toBe(text)
  })

  it('ignores incomplete (streaming) image lines', () => {
    const text = '![done](https://a.test/1.jpg)\n![partial](https://a.test/2'
    const out = groupMarkdownImages(text)
    expect(out).toBe(text)
  })

  it('generated gallery evaluates to a ready Grid spec', () => {
    const text = [
      '![First](https://a.test/1.jpg)',
      '![Second](https://a.test/2.jpg)',
      '![Third](https://a.test/3.jpg)'
    ].join('\n')
    const out = groupMarkdownImages(text)
    const fence = out.split('```spec')[1].split('```')[0]
    const result = createSpecFenceEvaluator().evaluate(fence.trim())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const elements = result.spec.elements as Record<string, { type?: string }>
    const grid = Object.values(elements).find(v => v?.type === 'Grid')
    expect(grid).toBeDefined()
    const images = Object.values(elements).filter(v => v?.type === 'Image')
    expect(images).toHaveLength(3)
  })
})
