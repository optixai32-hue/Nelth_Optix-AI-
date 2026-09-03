import { describe, expect, it } from 'vitest'

import { detectRequestCapabilities } from './capability-detection'

/**
 * Skills must trigger in EVERY user language, not just English/French.
 * These tests prove the intent layer (needsDocument / needsSearch /
 * needsImage / webImageSearch) fires for ES/DE/MG/AR/ZH/RU queries.
 */
describe('detectRequestCapabilities — all languages', () => {
  it('detects document intent in Spanish, German, Malagasy, Arabic, Chinese, Russian', async () => {
    for (const q of [
      'Crea una factura en PDF',
      'Erstelle eine Rechnung als PDF',
      'Mamorona taratasy PDF',
      'أنشئ فاتورة PDF',
      '创建发票PDF',
      'Создай договор в PDF'
    ]) {
      const caps = await detectRequestCapabilities(q)
      expect(caps.needsDocument, `query: ${q}`).toBe(true)
    }
  })

  it('detects search intent in Spanish, Malagasy, Arabic and Chinese', async () => {
    for (const q of [
      'Busca noticias de hoy',
      'Mitady vaovao androany',
      'ابحث عن أخبار اليوم',
      '搜索今天的新闻'
    ]) {
      const caps = await detectRequestCapabilities(q)
      expect(caps.needsSearch, `query: ${q}`).toBe(true)
    }
  })

  it('detects image-generation intent in Spanish and Chinese', async () => {
    for (const q of [
      'Crea una imagen de un gato',
      '生成一张猫的图片'
    ]) {
      const caps = await detectRequestCapabilities(q)
      expect(caps.needsImage, `query: ${q}`).toBe(true)
    }
  })

  it('detects web image-find intent in Spanish', async () => {
    const caps = await detectRequestCapabilities('Busca imágenes de gatos')
    expect(caps.webImageSearch).toBe(true)
    expect(caps.needsImage).toBe(false)
  })

  it('still detects the original English/French intents', async () => {
    const doc = await detectRequestCapabilities('Crée-moi une facture PDF')
    expect(doc.needsDocument).toBe(true)
    const search = await detectRequestCapabilities('cherche les actualités')
    expect(search.needsSearch).toBe(true)
    const img = await detectRequestCapabilities('génère une image de chat')
    expect(img.needsImage).toBe(true)
  })
})
