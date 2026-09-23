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
  variations?: number
}): Promise<VibesImageResult[]> {
  const count =
    Number.isInteger(input.variations) &&
    (input.variations as number) >= 1 &&
    (input.variations as number) <= 4
      ? (input.variations as number)
      : 1
  const single = () =>
    vibesFetch<{ success: boolean; data: VibesImageResult[] }>(
      '/api/vibes/images/generate',
      {
        project_id: VIBES_PROJECT_ID,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        variations: 1
      },
      55000
    )
  if (count <= 1) {
    const data = await single()
    return data.data ?? []
  }
  // The backend gateway times out (~40s+) on multi-variation synchronous
  // calls, so fan out N parallel single-variation calls instead (~13s
  // each). Partial success is tolerated — show whatever arrived.
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => single())
  )
  const merged = settled.flatMap(s =>
    s.status === 'fulfilled' ? (s.value.data ?? []) : []
  )
  if (merged.length === 0) throw new Error('La génération a échoué.')
  return merged
}

export async function vibesGenerateVideo(input: {
  prompt: string
  aspectRatio: ImagineAspectRatio
  resolution: ImagineResolution
  variations?: number
}): Promise<{ batchId: string }> {
  const data = await vibesFetch<{ success: boolean; batchId: string }>(
    '/api/vibes/videos/generate',
    {
      project_id: VIBES_PROJECT_ID,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      variations: input.variations ?? 1,
      poll: false
    },
    30000
  )
  if (!data.batchId) throw new Error('No batchId returned')
  return { batchId: data.batchId }
}

export interface VibesUploadResult {
  mediaEntId: string
  sourceImageEntId: string
  imageUrl: string
}

export async function vibesUploadImage(input: {
  base64: string
  filename?: string
}): Promise<
  VibesUploadResult & {
    allMediaEntIds: Array<{ accountIndex: number; mediaEntId: string }>
  }
> {
  const data = await vibesFetch<{
    mediaEntId: string
    sourceImageEntId: string
    imageUrl: string
    allMediaEntIds?: Array<{ accountIndex: number; mediaEntId: string }>
  }>(
    '/api/vibes/upload/media',
    {
      image_base64: input.base64,
      filename: input.filename ?? 'upload.png',
      project_id: VIBES_PROJECT_ID
    },
    60000
  )
  if (!data.sourceImageEntId) throw new Error('Upload sans identifiant.')
  return {
    mediaEntId: data.mediaEntId,
    sourceImageEntId: data.sourceImageEntId,
    imageUrl: data.imageUrl,
    allMediaEntIds: data.allMediaEntIds ?? []
  }
}

/**
 * Watermark removal + Nelth-IA logo (server-side on the vibes backend).
 * Returns the cleaned PNG bytes — the caller turns them into a browser
 * blob URL (session-local, no ImageKit involved).
 */
export async function vibesCleanImageBlob(fbcdnUrl: string): Promise<Blob> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(`${VIBES_API_BASE}/api/vibes/watermark/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: fbcdnUrl }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Clean failed (${res.status})`)
    return await res.blob()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Prompt enhancement (Z.ai backend, 1-3s). The API returns an explicit
 * `fallback` flag when enhancement failed and the original prompt is
 * returned as-is (vibes.ai accepts raw prompts).
 */
export async function vibesEnhancePrompt(
  prompt: string
): Promise<{ prompt: string; fallback: boolean }> {
  try {
    const data = await vibesFetch<{
      enhanced_prompt?: string
      fallback?: boolean
    }>('/api/prompts/enhance', { prompt }, 25000)
    const enhanced =
      typeof data.enhanced_prompt === 'string'
        ? data.enhanced_prompt.trim()
        : ''
    if (!enhanced) return { prompt, fallback: true }
    return { prompt: enhanced, fallback: data.fallback === true }
  } catch {
    return { prompt, fallback: true }
  }
}

export interface VibesEditResult {
  contentItem: { imageUrl: string; [k: string]: unknown }
  usedPrompt: string
  fallback: boolean
}

export async function vibesEditImage(input: {
  sourceImageEntId: string
  editPrompt: string
  allMediaEntIds?: Array<{ accountIndex: number; mediaEntId: string }>
}): Promise<VibesEditResult> {
  // Auto-enhance first (dashboard behavior), fallback to the raw prompt.
  const { prompt: enhanced, fallback } = await vibesEnhancePrompt(
    input.editPrompt
  )
  const data = await vibesFetch<{
    success: boolean
    contentItem?: { imageUrl: string }
  }>(
    '/api/vibes/images/edit',
    {
      source_image_ent_id: input.sourceImageEntId,
      edit_prompt: enhanced,
      project_id: VIBES_PROJECT_ID,
      ...(input.allMediaEntIds?.length
        ? { all_media_ent_ids: input.allMediaEntIds }
        : {})
    },
    55000
  )
  if (!data.contentItem?.imageUrl) throw new Error('Édition sans image.')
  // Raw fbcdn URL — the frontend cleans it into a session blob URL.
  return { contentItem: data.contentItem, usedPrompt: enhanced, fallback }
}

export async function vibesAnimateVideo(input: {
  source: { id: string; imageUrl: string; mediaEntId: string; prompt?: string }
  motion?: string
}): Promise<{ batchId: string }> {
  const data = await vibesFetch<{
    batchId?: string
    batch?: { id?: string }
    id?: string
  }>(
    '/api/vibes/videos/animate',
    {
      project_id: VIBES_PROJECT_ID,
      source_image: {
        id: input.source.id,
        imageUrl: input.source.imageUrl,
        mediaEntId: input.source.mediaEntId,
        prompt: input.source.prompt ?? 'Uploaded image'
      },
      ...(input.motion ? { prompt: input.motion } : {}),
      poll: false
    },
    30000
  )
  const batchId = data.batchId || data.batch?.id || data.id
  if (!batchId) throw new Error('No batchId returned')
  return { batchId }
}

export async function vibesPollBatch(batchId: string): Promise<VibesBatch> {
  return vibesFetch<VibesBatch>(
    `/api/vibes/batches/${encodeURIComponent(batchId)}/poll?timeout=5`,
    {},
    25000
  )
}
