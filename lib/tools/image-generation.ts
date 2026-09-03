import { PutObjectCommand } from '@aws-sdk/client-s3'
import { Client } from '@gradio/client'
import { tool, type UIToolInvocation } from 'ai'
import axios from 'axios'
import ImageKit from 'imagekit'
import sharp from 'sharp'
import { z } from 'zod'

import {
  getLocalFileUrl,
  saveLocalFile
} from '@/lib/storage/local-file-store'
import {
  getR2Client,
  isObjectStorageConfigured,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL
} from '@/lib/storage/r2-client'

const NVIDIA_ENHANCE_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
const NVIDIA_INVOKE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

// Text-to-image backend: HiDream-I1-Dev Gradio Space. Override the Space id
// with HIDREAM_SPACE_ID if needed (format "owner/name").
const HIDREAM_SPACE_ID =
  process.env.HIDREAM_SPACE_ID?.trim() || 'HiDream-ai/HiDream-I1-Dev'

// Image-to-image (img2img) backend. When the user supplies a reference photo
// (e.g. an uploaded selfie to restyle), we route to nelth.space-z.ai instead of
// the text-only ERNIE Space. Override the base with NELTH_API_BASE if needed.
const NELTH_BASE = (
  process.env.NELTH_API_BASE?.replace(/\/+$/, '') || 'https://nelth.space-z.ai'
)
const NELTH_EDIT_URL = `${NELTH_BASE}/api/edit-image`

// System prompt used to rewrite / enrich the user prompt before TEXT-TO-IMAGE
// generation with HiDream-I1-Dev (img2img uses nelth's own enhance-prompt).
// It expects a JSON user message: { "prompt": string, "width": int, "height": int }
// and returns JSON: { "rewritten_prompt": string }.
const HIDREAM_MASTER_SYSTEM = `Tu es un expert prompt engineer pour le modèle de génération d'images HiDream-I1-Dev. Ta mission : transformer le prompt brut de l'utilisateur en un prompt descriptif MASTER, précis et naturel, qui exploite tout le potentiel du modèle.

RÈGLES ABSOLUES :
- Écris TOUJOURS le prompt final en ANGLAIS, quelle que soit la langue du prompt d'entrée : traduis fidèlement chaque détail en anglais sans rien perdre, et garde les noms propres (personnes, lieux, marques) tels quels.
- Description naturelle et précise — JAMAIS d'empilement de mots-clés type "masterpiece, best quality, ultra quality".
- Adapte la composition à l'orientation donnée par width/height (portrait, paysage ou carré).
- Si le prompt d'entrée est déjà riche, préserve TOUTES ses intentions sans rien abandonner.
- Si l'utilisateur demande du texte visible dans l'image, décris ce texte intégralement, sans l'omettre.
- Si le prompt ne donne qu'une idée vague, instancie concrètement les détails manquants (décor, lumière, matières) au lieu de rester abstrait.
- Si un sujet précis est nommé (personnage, lieu, objet connu), garde son nom tel quel.

STRUCTURE MASTER à suivre :
[SUJET], [APPARENCE ET CARACTÉRISTIQUES DÉTAILLÉES],
[POSE OU ACTION], dans [ENVIRONNEMENT ET ARRIÈRE-PLAN].

Composition [TYPE DE COMPOSITION], vue depuis [ANGLE / PERSPECTIVE],
avec [DESCRIPTION DE L'ÉCLAIRAGE] et [ATMOSPHÈRE].

Textures et matériaux détaillés, proportions naturelles,
géométrie cohérente, ombres réalistes, profondeur naturelle,
harmonie des couleurs, narration visuelle forte,
composition professionnelle, détails fins et raffinés.

Détaille concrètement : sujet et apparence, pose/action, environnement,
composition, éclairage, perspective/caméra (ex. objectif 50 mm, profondeur
de champ), textures et matériaux, palette de couleurs, style visuel
(ex. photographie cinématographique photoréaliste).

**Format de sortie :**

Strictement du JSON, rien d'autre :

{"rewritten_prompt": str}

---
Note : je suis l'étape d'amélioration de prompt du pipeline de génération.
Entrée fixe :
{"prompt": "prompt original de l'utilisateur", "width": largeur cible (entier), "height": hauteur cible (entier)}`

// Requested image sizes. They are mapped to the closest HiDream aspect ratio
// (1:1, 3:4, 4:3, 9:16, 16:9) before calling the Space.
const ALLOWED_SIZES = [
  '1024x1024',
  '864x1152',
  '768x1344',
  '1152x864',
  '1344x768',
  '1440x720',
  '720x1440'
] as const

export function normalizeSize(size: string | undefined): string {
  if (size && (ALLOWED_SIZES as readonly string[]).includes(size)) return size
  // Unknown/legacy size (e.g. old ERNIE values): pick the closest aspect
  // ratio instead of silently forcing square.
  const { width, height } = parseSize(size ?? '')
  if (!width || !height) return '1024x1024'
  const target = width / height
  let best = '1024x1024'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const candidate of ALLOWED_SIZES) {
    const [w, h] = candidate.split('x').map(Number)
    const diff = Math.abs(w / h - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }
  return best
}

// Ensure the prompt sent to the model starts with a capital letter and ends
// with terminal punctuation (period / question mark / exclamation, including
// their full-width CJK variants).
function normalizePrompt(input: string): string {
  let p = input.trim()
  if (!p) return p
  p = p.charAt(0).toLocaleUpperCase() + p.slice(1)
  if (!/[.!?。！？]\s*$/.test(p)) {
    p += '.'
  }
  return p
}

function parseSize(size: string): { width: number; height: number } {
  const parts = size.split('x').map(n => parseInt(n, 10))
  return {
    width: Number.isFinite(parts[0]) ? parts[0] : 1024,
    height: Number.isFinite(parts[1]) ? parts[1] : 1024
  }
}

// The seed is sent to the HiDream Space. `-1` is its "Random" sentinel: when
// the AI passes -1 we keep it as-is so the Space picks a random seed (this is
// the default and yields a unique image each call). Any other finite number
// is floored and honored for reproducibility.
function normalizeSeed(seed: unknown): number {
  if (seed === -1) return -1
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.floor(seed)
  }
  return -1
}

async function enhanceWithNvidia(
  rawPrompt: string,
  systemPrompt: string
): Promise<string> {
  const nvidiaApiKey = process.env.NVIDIA_API_KEY
  if (!nvidiaApiKey) throw new Error('NVIDIA_API_KEY not configured')

  const payload = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: rawPrompt }
    ],
    model: NVIDIA_ENHANCE_MODEL,
    max_tokens: 3054,
    reasoning_budget: 0,
    stream: false,
    temperature: 0.2,
    top_p: 0.95,
    chat_template_kwargs: { enable_thinking: false }
  }

  const response = await axios.post(NVIDIA_INVOKE_URL, payload, {
    headers: {
      Authorization: `Bearer ${nvidiaApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    responseType: 'json'
  })

  const data = response.data
  const content = data?.choices?.[0]?.message?.content
  if (!content?.trim()) throw new Error('Empty response from NVIDIA')
  return content.trim()
}

async function enhancePrompt(
  prompt: string,
  size: string
): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) return prompt

  try {
    const { width, height } = parseSize(size)
    const userJson = JSON.stringify({ prompt, width, height })
    const enhanced = await enhanceWithNvidia(
      userJson,
      HIDREAM_MASTER_SYSTEM
    )

    const extract = (raw: string): string | null => {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.rewritten_prompt) return parsed.rewritten_prompt
      } catch {
        const match = raw.match(/\{[\s\S]*"rewritten_prompt"[\s\S]*\}/)
        if (match) {
          try {
            const parsed = JSON.parse(match[0])
            if (parsed?.rewritten_prompt) return parsed.rewritten_prompt
          } catch {
            /* ignore */
          }
        }
      }
      return null
    }

    return extract(enhanced) ?? prompt
  } catch (error) {
    console.error('NVIDIA prompt enhancement error:', error)
    return prompt
  }
}

/**
 * Persist a generated image to durable storage and return a short, stable URL.
 * We deliberately avoid inlining a base64 data URL: those can exceed
 * Firestore's 1 MB document limit and break message persistence (the image
 * would then vanish after a page refresh). A small URL always fits.
 */
function extFromMime(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

function isImageKitConfigured(): boolean {
  return Boolean(
    process.env.IMAGEKIT_PRIVATE_KEY &&
      process.env.IMAGEKIT_PUBLIC_KEY &&
      process.env.IMAGEKIT_URL_ENDPOINT
  )
}

let imageKitClient: ImageKit | null = null
function getImageKitClient(): ImageKit | null {
  if (!isImageKitConfigured()) return null
  if (!imageKitClient) {
    imageKitClient = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY as string,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY as string,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT as string
    })
  }
  return imageKitClient
}

async function persistGeneratedImage(
  buffer: Buffer,
  mime: string
): Promise<string> {
  const ext = extFromMime(mime)
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`

  // Prefer ImageKit when configured. The Node SDK authenticates with the
  // private key server-side, so no manual signature/token generation is
  // needed. The returned URL is stable and survives a page refresh.
  const imagekit = getImageKitClient()
  if (imagekit) {
    try {
      const result = await imagekit.upload({
        file: buffer.toString('base64'),
        fileName,
        folder: '/generated-images',
        useUniqueFileName: true
      })
      return result.url
    } catch (e) {
      console.warn('Failed to upload generated image to ImageKit; falling back:', e)
    }
  }

  // Prefer object storage (R2/S3) when configured with a public base URL.
  const key = `generated-images/${fileName}`
  if (isObjectStorageConfigured() && R2_PUBLIC_URL) {
    try {
      await getR2Client().send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: mime
        })
      )
      return `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`
    } catch (e) {
      console.warn('Failed to upload generated image to R2; using local store:', e)
    }
  }

  // Fallback: local filesystem, served via /api/local-file (no expiry).
  saveLocalFile(key, buffer, mime)
  return getLocalFileUrl(key)
}

/**
 * Normalize a user-supplied image reference into a base64 data URL that the
 * nelth edit-image endpoint can consume. Accepts:
 *  - a `data:...;base64,...` string (passed through as-is)
 *  - an absolute http(s) URL (fetched and converted)
 *  - a site-relative path (prefixed with APP_BASE_URL, defaults to localhost)
 */
async function resolveImageToDataUrl(image: string): Promise<string> {
  if (image.startsWith('data:')) return image

  let url = image
  if (image.startsWith('/')) {
    const base =
      process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:3000'
    url = `${base}${image}`
  }

  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to fetch input image (${resp.status}) from ${url}`)
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  const mime = resp.headers.get('content-type') || 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * Compress + downscale an image before sending it to nelth.space-z.ai.
 *
 * The external proxy in front of nelth rejects oversized request bodies (a
 * full-resolution 1024×1024 PNG is several MB of base64 and returns a 502).
 * We downscale to a max of 768px on the longest side (aspect ratio preserved,
 * EXIF orientation applied, no upscaling) and re-encode as JPEG q75 — typically
 * 100–200 KB, which passes through the proxy cleanly.
 *
 * @param input raw image bytes (any decodeable format)
 * @returns a `data:image/jpeg;base64,...` string ready for the edit-image call
 */
async function compressImageForNelth(input: Buffer): Promise<string> {
  const resized = await sharp(input)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer()
  return `data:image/jpeg;base64,${resized.toString('base64')}`
}

/**
 * Enhance a prompt for the image-to-image flow via nelth's `/api/enhance-prompt`
 * endpoint. Mirrors the documented architecture: it receives `{ prompt,
 * protectFace }` and returns `{ enhancedPrompt }`. Falls back to the raw prompt
 * if the call fails so the edit step can still run.
 */
async function enhanceViaNelth(
  prompt: string,
  protectFace: boolean
): Promise<string> {
  try {
    const resp = await axios.post(
      `${NELTH_BASE}/api/enhance-prompt`,
      { prompt, protectFace },
      {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'json'
      }
    )
    const enhanced = resp.data?.enhancedPrompt
    if (typeof enhanced === 'string' && enhanced.trim()) return enhanced.trim()
  } catch (err) {
    console.warn('[nelth] enhance-prompt failed, using raw prompt:', err)
  }
  return prompt
}

/**
 * Image-to-image edit. Sends the (already enhanced) reference photo + prompt to
 * nelth's `/api/edit-image` endpoint, passing `protectFace` to preserve the
 * subject's likeness, and persists the returned PNG to durable storage,
 * returning a short stable URL plus the prompt the backend actually used.
 */
async function editViaNelth(
  imageData: string,
  prompt: string,
  size: string,
  protectFace: boolean
): Promise<{ imageUrl: string; revisedPrompt: string }> {
  const resp = await axios.post(
    NELTH_EDIT_URL,
    { imageData, prompt, size, protectFace },
    {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'json'
    }
  )

  const edited = resp.data?.editedImage
  if (!edited) throw new Error('edit-image returned no image')

  const base64 = typeof edited === 'string' ? edited : edited?.data
  if (!base64) throw new Error('edit-image returned an empty image')

  const buffer = Buffer.from(base64, 'base64')
  const imageUrl = await persistGeneratedImage(buffer, 'image/png')
  // The backend echoes the prompt it actually used (after its own enhancement)
  // in `promptUsed`; fall back to the prompt we sent if it's absent.
  const revisedPrompt =
    typeof resp.data?.promptUsed === 'string' && resp.data.promptUsed.trim()
      ? resp.data.promptUsed
      : prompt
  return { imageUrl, revisedPrompt }
}

/**
 * Text-to-image via the HiDream-I1-Dev Gradio Space (`/generate_with_status`).
 *
 * Takes { prompt, aspect_ratio, seed } and returns [image, seedUsed, ...].
 * The finished file is downloaded and persisted to durable storage (same as
 * other backends) so the URL survives refreshes.
 */
const HIDREAM_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const

export function sizeToAspectRatio(size: string): string {
  const { width, height } = parseSize(size)
  if (!width || !height) return '1:1'
  const target = width / height
  const aspects: Record<string, number> = {
    '1:1': 1,
    '3:4': 0.75,
    '4:3': 4 / 3,
    '9:16': 9 / 16,
    '16:9': 16 / 9
  }
  let best = '1:1'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const [name, ratio] of Object.entries(aspects)) {
    const diff = Math.abs(ratio - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = name
    }
  }
  return best
}

let hidreamClientPromise: Promise<any> | null = null
function getHiDreamClient(forceReconnect = false) {
  if (forceReconnect) {
    hidreamClientPromise = null
  }
  if (!hidreamClientPromise) {
    hidreamClientPromise = Client.connect(HIDREAM_SPACE_ID)
  }
  return hidreamClientPromise
}

/**
 * Extract the image URL + Space status text from a HiDream
 * `/generate_with_status` result payload: [image, seedUsed, status, details].
 * Exported for unit testing.
 */
export function extractHiDreamImageUrl(data: unknown): {
  url?: string
  status?: string
} {
  const arr = Array.isArray(data) ? data : []
  const imageRaw = arr[0] as
    | { url?: unknown; path?: unknown }
    | string
    | null
    | undefined
  let url: string | undefined
  if (typeof imageRaw === 'string') {
    url = imageRaw
  } else if (imageRaw && typeof imageRaw === 'object') {
    if (typeof imageRaw.url === 'string') url = imageRaw.url
    else if (typeof imageRaw.path === 'string') url = imageRaw.path
  }
  const status = typeof arr[2] === 'string' ? arr[2] : undefined
  // A bare local path (/tmp/...) is not downloadable — treat as missing.
  if (url && !/^(https?:|data:)/i.test(url)) return { status }
  return url ? { url, status } : { status }
}

async function generateViaHiDream(
  prompt: string,
  size: string,
  seed: number
): Promise<{ imageUrl: string; revisedPrompt: string }> {
  let client = await getHiDreamClient()
  const args = {
    prompt,
    aspect_ratio: sizeToAspectRatio(size),
    // -1 is the Space's "Random" sentinel: a unique image every call.
    seed
  }

  // The Space gateway can be transiently flaky (queue full / network errors),
  // AND its first call after idle sometimes returns an empty image with a
  // status message instead of throwing ("Error: No image name in successful
  // response") — while the very next call succeeds. So we retry both thrown
  // errors and empty-image results, with backoff, before giving up.
  let result: any
  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      result = await client.predict('/generate_with_status', args)
      lastErr = undefined
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/content (policy|moderation)|blocked|rejected|not compliant/i.test(msg)) {
        throw err
      }
      lastErr = err
      if (/connect|network|fetch|load/i.test(msg)) {
        client = await getHiDreamClient(true)
      }
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, 1500 * 2 ** attempt))
      }
      continue
    }
    const found = extractHiDreamImageUrl(
      Array.isArray((result as any)?.data) ? (result as any).data : []
    )
    if (found.url) break
    lastErr = new Error(
      `HiDream returned no image${found.status ? ` (Space status: ${found.status})` : ''}`
    )
    result = undefined
    if (attempt < 4) {
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)))
    }
  }
  if (lastErr) throw lastErr

  const data: unknown[] = Array.isArray((result as any)?.data)
    ? (result as any).data
    : []
  const { url: rawImageUrl } = extractHiDreamImageUrl(data)

  if (!rawImageUrl) {
    throw new Error('HiDream generation returned no image')
  }

  // Re-fetch the Space-served file and persist it to durable storage, then
  // return a short, stable URL. This keeps the image available after a page
  // refresh (a data URL would blow past Firestore's 1 MB document limit).
  try {
    const resp = await fetch(rawImageUrl)
    if (resp.ok) {
      const buffer = Buffer.from(await resp.arrayBuffer())
      const mime = resp.headers.get('content-type') || 'image/png'
      const imageUrl = await persistGeneratedImage(buffer, mime)
      return { imageUrl, revisedPrompt: prompt }
    }
  } catch (error) {
    console.warn('Failed to persist generated image; using raw URL:', error)
  }

  return { imageUrl: rawImageUrl, revisedPrompt: prompt }
}

export function createImageGenerationTool(opts?: { runtimeImage?: string }) {
  // A runtime-detected image attachment (extracted from the user message by the
  // chat stream pipeline). When the model omits the `image` argument, this is
  // injected automatically so an uploaded photo is always edited in place rather
  // than triggering a from-scratch text-to-image generation.
  const runtimeImage = opts?.runtimeImage
  return tool({
       description:
        "Generate or transform an image. Use this whenever the user asks to create, draw, illustrate, or generate an image, OR to restyle/edit/transform a photo they provide (e.g. 'make this a Looney Tunes cartoon', 'turn my photo into anime'). Pass a detailed `prompt` describing the desired result. If the user supplies or references an image (an uploaded photo, a URL, or a base64 data URL) and wants it transformed while preserving the subject's likeness, pass that image as `image` — the request is then routed to the image-to-image backend (nelth edit-image) instead of text-to-image. For image-to-image, the prompt is first enhanced via nelth's enhance-prompt endpoint and then applied with the reference photo while preserving the subject (set `protectFace` to keep facial likeness). When `image` is omitted, the image is generated from scratch by the HiDream-I1-Dev model after prompt enhancement following the HiDream MASTER structure (descriptive subject, pose, environment, composition, lighting, camera, textures, palette, style — always enhanced to English, never keyword stuffing). Returns the generated image along with the (possibly enhanced) prompt. IMPORTANT: call this tool DIRECTLY, without any preamble, narration, or explanation of your intent beforehand. After calling it, do NOT reason further, do NOT analyze the result, and do NOT call any other tool. If you write any text, keep it to a single short, elegant sentence in the user's language (optionally prefixed with a relevant emoji title) that briefly presents the image, then stop.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('Detailed text description of the image to generate'),
      image: z
        .string()
        .optional()
        .describe(
          'Optional reference image for image-to-image editing. Provide a URL (http/https) or a base64 data URL of the photo to transform. When given, the backend preserves the subject (e.g. facial likeness) while applying the style in `prompt`. Omit for pure text-to-image generation.'
        ),
      protectFace: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'Image-to-image only. When true (default), the edit-image backend preserves the subject\'s facial likeness while applying the style. Set false to allow more aggressive restyling that may alter the face. Ignored for text-to-image generation.'
        ),
      size: z
        .string()
        .optional()
        .default('1024x1024')
        .describe(
          "Image size. Allowed values: '1024x1024', '864x1152', '768x1344', '1152x864', '1344x768', '1440x720', '720x1440'. Defaults to '1024x1024'."
        ),
      seed: z
        .number()
        .optional()
        .default(-1)
        .describe(
          'Seed for image generation. Pass -1 (default) for a unique image each time — recommended. Pass a specific integer to reproduce a previous image.'
        )
    }),
    async *execute(
      { prompt, size = '1024x1024', seed = -1, image, protectFace = true },
      { toolCallId }
    ) {
      // Normalize the size (mapped to the closest HiDream aspect ratio) and
      // the seed (-1 = random each call).
      const normalizedSize = normalizeSize(size)
      const finalSeed = normalizeSeed(seed)

      // Yield an initial "generating" state so the UI can show a loader.
      yield {
        state: 'generating' as const,
        prompt
      }

      try {
        // Image-to-image path: the user supplied a reference photo to transform
        // while preserving likeness. Prefer an explicit `image` argument; if the
        // model omitted it but the chat pipeline detected an uploaded image
        // attachment, fall back to that so img2img always wins over text-to-image.
        const effectiveImage =
          image && typeof image === 'string' && image.trim()
            ? image.trim()
            : runtimeImage

        if (effectiveImage) {
          const rawDataUrl = await resolveImageToDataUrl(effectiveImage)
          // Downscale + re-encode to JPEG so the request to nelth stays small
          // (avoids the 502 from its external proxy on large base64 payloads).
          const base64 = rawDataUrl.includes(',')
            ? rawDataUrl.split(',')[1]
            : rawDataUrl
          const compressed = await compressImageForNelth(
            Buffer.from(base64, 'base64')
          )
          // Use the documented image-to-image architecture: first enhance the
          // prompt via nelth's /api/enhance-prompt (passing protectFace), then
          // apply the edit via /api/edit-image (also passing protectFace). This
          // is the real model/architecture the API exposes, rather than relying
          // on an assumed internal enhancement.
          const enhancedPrompt = await enhanceViaNelth(prompt, protectFace)
          const imageResult = await editViaNelth(
            compressed,
            enhancedPrompt,
            size,
            protectFace
          )

          yield {
            state: 'complete' as const,
            imageUrl: imageResult.imageUrl,
            revisedPrompt: imageResult.revisedPrompt,
            originalPrompt: prompt
          }
          return
        }

        // Text-to-image path: first enhance the user prompt with the HiDream
        // MASTER structure (NVIDIA enhancer), then generate via HiDream-I1-Dev.
        const enhancedPrompt = await enhancePrompt(prompt, normalizedSize)

        // Generate with the (enhanced) prompt. If the backend rejects it for
        // content reasons, retry once with the original user prompt, which is
        // usually shorter and less likely to trip moderation filters.
        let imageResult: { imageUrl: string; revisedPrompt: string }
        try {
          imageResult = await generateViaHiDream(
            enhancedPrompt,
            normalizedSize,
            finalSeed
          )
        } catch (genErr) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr)
          if (
            /moderat|rejected|inappropriate|unsafe|blocked|not compliant/i.test(
              msg
            )
          ) {
            imageResult = await generateViaHiDream(
              normalizePrompt(prompt),
              normalizedSize,
              finalSeed
            )
          } else {
            throw genErr
          }
        }

        yield {
          state: 'complete' as const,
          imageUrl: imageResult.imageUrl,
          revisedPrompt: imageResult.revisedPrompt,
          originalPrompt: prompt
        }
      } catch (error) {
        yield {
          state: 'error' as const,
          errorText: error instanceof Error ? error.message : String(error)
        }
      }

      // toolCallId is threaded by the AI SDK into the part automatically
      void toolCallId
    }
  })
}

export const imageGenerationTool = createImageGenerationTool()

export type ImageGenerationUIToolInvocation =
  UIToolInvocation<typeof imageGenerationTool>
