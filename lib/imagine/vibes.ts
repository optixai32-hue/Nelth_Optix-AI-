/**
 * Vibes backend client (server-side only — keeps VIBES_PROJECT_ID secret).
 * Public app: https://nelcia.space-z.ai/ — see WebAPI docs.
 */

const VIBES_API_BASE =
  process.env.VIBES_API_BASE_URL || 'https://nelcia.space-z.ai'

const VIBES_PROJECT_ID =
  process.env.VIBES_PROJECT_ID || '8dbdbb11-0b6a-4ddb-8f06-e090af291630'

export type ImagineAspectRatio = '1:1' | '16:9' | '9:16'
export type ImagineResolution = '480p' | '720p'

export interface VibesImageResult {
  url: string
  prompt?: string
  imageEntId?: string
  dimensions?: { width: number; height: number }
  watermarkRemoved?: boolean
  hostedOnImagekit?: boolean
  deletedFromVibes?: boolean
}

export interface VibesBatchContent {
  id: string
  videoUrl?: string | null
  imageUrl?: string | null
  isLoading?: boolean
}

export interface VibesBatch {
  id: string
  isComplete: boolean
  content: VibesBatchContent[]
}

async function vibesFetch<T>(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${VIBES_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: string })
      | null
    if (!res.ok || !data) {
      throw new Error(
        (data as { error?: string } | null)?.error ||
          `Vibes API error (${res.status})`
      )
    }
    if (typeof (data as { error?: string }).error === 'string') {
      throw new Error((data as { error?: string }).error)
    }
    return data as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function vibesGenerateImages(input: {
  prompt: string
  aspectRatio: ImagineAspectRatio
}): Promise<VibesImageResult[]> {
  const data = await vibesFetch<{ success: boolean; data: VibesImageResult[] }>(
    '/api/vibes/images/generate',
    {
      project_id: VIBES_PROJECT_ID,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      variations: 1
    },
    55000
  )
  return data.data ?? []
}

export async function vibesGenerateVideo(input: {
  prompt: string
  aspectRatio: ImagineAspectRatio
  resolution: ImagineResolution
}): Promise<{ batchId: string }> {
  const data = await vibesFetch<{ success: boolean; batchId: string }>(
    '/api/vibes/videos/generate',
    {
      project_id: VIBES_PROJECT_ID,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      variations: 1,
      poll: false
    },
    30000
  )
  if (!data.batchId) throw new Error('No batchId returned')
  return { batchId: data.batchId }
}

export async function vibesPollBatch(batchId: string): Promise<VibesBatch> {
  return vibesFetch<VibesBatch>(
    `/api/vibes/batches/${encodeURIComponent(batchId)}/poll?timeout=5`,
    {},
    25000
  )
}
