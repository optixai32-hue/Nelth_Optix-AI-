import { NextResponse } from 'next/server'

import {
  createSearchProvider,
  resolveSearchProviderType
} from '@/lib/tools/search/providers'

export const runtime = 'nodejs'

export async function GET() {
  const providerType = resolveSearchProviderType()
  const provider = createSearchProvider()
  const started = Date.now()
  try {
    const result = await provider.search(
      'latest AI news 2026',
      10,
      'basic',
      [],
      [],
      { content_types: ['web'] }
    )
    const elapsed = Date.now() - started
    return NextResponse.json({
      providerType,
      resultsCount: result.results.length,
      imagesCount: result.images.length,
      elapsedMs: elapsed,
      sample: result.results.slice(0, 3).map(r => ({
        title: r.title,
        url: r.url
      }))
    })
  } catch (e: any) {
    return NextResponse.json(
      {
        providerType,
        error: String(e?.message ?? e),
        elapsedMs: Date.now() - started
      },
      { status: 500 }
    )
  }
}
