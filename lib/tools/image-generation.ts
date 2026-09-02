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

const HF_SPACE = 'baidu/ERNIE-Image-Turbo'
const NVIDIA_ENHANCE_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
const NVIDIA_INVOKE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

// Image-to-image (img2img) backend. When the user supplies a reference photo
// (e.g. an uploaded selfie to restyle), we route to nelth.space-z.ai instead of
// the text-only ERNIE Space. Override the base with NELTH_API_BASE if needed.
const NELTH_BASE = (
  process.env.NELTH_API_BASE?.replace(/\/+$/, '') || 'https://nelth.space-z.ai'
)
const NELTH_EDIT_URL = `${NELTH_BASE}/api/edit-image`

// System prompt used to rewrite / enrich the user prompt before generation.
// It expects a JSON user message: { "prompt": string, "width": int, "height": int }
// and returns JSON: { "rewritten_prompt": string }.
const IMAGE_CAPTION_SYSTEM = `你是一个智能图像描述助手。你的任务是用**中文**生成一段**尽量详尽、信息丰富且客观**的图片描述，用于高质量图像理解与标注。

**总体要求：**

* 以最终要生成出来的画面为目标，描述其中**实际应当可见**的内容，不进行主观评价。
* 对于用户已经明确提出的需求，以及为了让画面成立而必须出现的内容，可以进行合理补全；不要停留在抽象概括层，不要只写功能，不写具体内容。
* 直接进入描述内容，不使用"这是一张……"等元描述开头。
* 描述应结构清晰、语言准确、信息充分。
* 总长度控制在 **1000 tokens** 以内，在不冗余的前提下尽量详细。

---

### 具体要求：

1. **图片类型说明**
   明确指出图片类型，如：照片、截图、插画、手绘图、海报、广告图、界面截图等。

2. **主体与场景描述**。描述主要人物、动物、物体或建筑，包括数量、位置、姿态、外观特征。描述所处环境：室内 / 室外、自然 / 城市背景、天气、时间线索、空间布局。

3. **视觉细节与风格**
   描述构图方式。描述光线、色调、清晰度、画面风格。

4. **实体识别**
   明确写出可识别的实体名称。

5. **文字抄录规则**
   只转录**清晰可见且可辨认**的文字内容，按原文语种逐字抄录。

6. **内容实例化规则**
   如果用户给的是主题、结构、功能、关系、画面框架、页面布局、叙事方向或抽象要求，而没有把所有细节都写全，你需要把其中隐含但对最终画面成立很重要的内容**具体实例化**出来。

7. **界面与附加元素（如适用）**
   若为截图或界面图，描述按钮、图标、菜单栏、状态栏等可见UI元素。

---

**输出格式：**

严格以 JSON 格式输出，不要输出任何 JSON 之外的文字：

{"rewritten_prompt": str}

---

注意：我是图像生成流程的 prompt 增强环节。输入格式固定为：
{"prompt": "用户原始 prompt", "width": 目标宽度整数, "height": 目标高度整数}

你的任务是：
1. 读取其中的 \`prompt\` 作为用户需求。
2. 结合 \`width\` 和 \`height\` 理解目标画面的横竖比例与构图倾向。
3. 用上面的描述风格，生成这个图片的描述。
4. 这个图片要完美契合用户 prompt，并且与给定宽高比例相适配。
5. 如果用户 prompt 给的很长，不要丢弃任何用户意图。
6. 如果用户 prompt 需要生成文字才能满足，则生成完整的文字，不要省略或留白。
7. 如果用户 prompt 只给了结构、功能、题材、关系或故事框架，没有给出全部细节，你需要主动把画面中本应出现的具体内容补全出来。

注意：
* 如果用户 prompt 中包含某个特定主体（例如二次元的某个角色），生成的描述中要有这个角色的名字，并且不要过度描述角色的特征。
* 不要把用户需求里的抽象槽位原样保留下来；应尽量把它们展开成可见、可画、可渲染的具体内容。
* 不要在输出里复述输入 JSON。
* 重要！！一定要确认你的描述中，包含了这张图片中所有的需要的文字内容，不能遗漏省略任何。`

// Sizes supported by the ERNIE-Image-Turbo Space (must match its dropdown).
const ALLOWED_SIZES = [
  '1024x1024',
  '848x1264',
  '1264x848',
  '1376x768',
  '1200x896',
  '896x1200',
  '768x1376'
] as const

function normalizeSize(size: string | undefined): string {
  return size && (ALLOWED_SIZES as readonly string[]).includes(size)
    ? size
    : '1024x1024'
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

// The seed is sent to the ERNIE Space. `-1` is its "Random" sentinel: when the
// AI passes -1 we keep it as-is so the Space picks a random seed (this is the
// default and yields a unique image each call). A specific 10-digit integer
// (1000000000–9999999999) is honored for reproducibility. Any other value is
// replaced by a random 10-digit number server-side.
function normalizeSeed(seed: unknown): number {
  if (seed === -1) return -1
  if (
    typeof seed === 'number' &&
    Number.isFinite(seed) &&
    seed >= 1000000000 &&
    seed <= 9999999999
  ) {
    return Math.floor(seed)
  }
  return Math.floor(1000000000 + Math.random() * 9000000000)
}

function parseSize(size: string): { width: number; height: number } {
  const parts = size.split('x').map(n => parseInt(n, 10))
  return {
    width: Number.isFinite(parts[0]) ? parts[0] : 1024,
    height: Number.isFinite(parts[1]) ? parts[1] : 1024
  }
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
      IMAGE_CAPTION_SYSTEM
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

let clientPromise: Promise<any> | null = null
function getBaiduDateHeaders(): Record<string, string> {
  const now = new Date().toISOString()
  return { date: now, 'x-bce-date': now }
}

function getGradioClient(forceReconnect = false) {
  if (forceReconnect) {
    clientPromise = null
  }
  if (!clientPromise) {
    clientPromise = Client.connect(HF_SPACE, {
      headers: getBaiduDateHeaders()
    })
  }
  return clientPromise
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

async function generateViaGradio(
  prompt: string,
  size: string,
  seed: number
): Promise<{ imageUrl: string; revisedPrompt: string }> {
  let client = await getGradioClient()
  const args = {
    // `seed` is provided by the model (the AI generates a random value each
    // call so every image differs). -1 is the Space's "Random" sentinel.
    // `use_pe: false` skips Baidu's own prompt-enhancement step (faster).
    // Our tool already enhances the prompt via NVIDIA, so this is redundant.
    prompt: normalizePrompt(prompt),
    size,
    seed,
    use_pe: false
  }

  // The Baidu gateway behind this Space is intermittently flaky (it sometimes
  // returns "MissingDateHeader" / 404 / network errors). These are transient,
  // so we retry a few times. We deliberately do NOT retry deterministic
  // content-moderation rejections (errorCode 40000 / "内容不合规").
  let result: any
  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      result = await client.predict('/generate_image', args)
      lastErr = undefined
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/内容不合规|40000|not compliant/i.test(msg)) throw err
      lastErr = err
      if (/MissingDateHeader|x-bce-date|date header/i.test(msg)) {
        client = await getGradioClient(true)
      }
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, 800 * 2 ** attempt))
      }
    }
  }
  if (lastErr) throw lastErr

  const data: unknown[] = Array.isArray((result as any)?.data)
    ? (result as any).data
    : []
  const imageRaw = data[0]
  const revisedPrompt: string | undefined =
    typeof data[1] === 'string' ? data[1] : undefined

  let rawImageUrl: string | undefined
  if (typeof imageRaw === 'string') {
    rawImageUrl = imageRaw
  } else if (imageRaw && typeof imageRaw === 'object') {
    rawImageUrl = (imageRaw as any).url || (imageRaw as any).path
  }

  if (!rawImageUrl) {
    throw new Error('Image generation returned no image')
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
      return {
        imageUrl,
        revisedPrompt: revisedPrompt || prompt
      }
    }
  } catch (error) {
    console.warn('Failed to persist generated image; using raw URL:', error)
  }

  return { imageUrl: rawImageUrl, revisedPrompt: revisedPrompt || prompt }
}

export function createImageGenerationTool(opts?: { runtimeImage?: string }) {
  // A runtime-detected image attachment (extracted from the user message by the
  // chat stream pipeline). When the model omits the `image` argument, this is
  // injected automatically so an uploaded photo is always edited in place rather
  // than triggering a from-scratch text-to-image generation.
  const runtimeImage = opts?.runtimeImage
  return tool({
       description:
        "Generate or transform an image. Use this whenever the user asks to create, draw, illustrate, or generate an image, OR to restyle/edit/transform a photo they provide (e.g. 'make this a Looney Tunes cartoon', 'turn my photo into anime'). Pass a detailed `prompt` describing the desired result. If the user supplies or references an image (an uploaded photo, a URL, or a base64 data URL) and wants it transformed while preserving the subject's likeness, pass that image as `image` — the request is then routed to the image-to-image backend (nelth edit-image) instead of text-to-image. For image-to-image, the prompt is first enhanced via nelth's enhance-prompt endpoint and then applied with the reference photo while preserving the subject (set `protectFace` to keep facial likeness). When `image` is omitted, the image is generated from scratch by the ERNIE Image Turbo model via NVIDIA prompt enhancement. Returns the generated image along with the (possibly enhanced) prompt. IMPORTANT: call this tool DIRECTLY, without any preamble, narration, or explanation of your intent beforehand. After calling it, do NOT reason further, do NOT analyze the result, and do NOT call any other tool. If you write any text, keep it to a single short, elegant sentence in the user's language (optionally prefixed with a relevant emoji title) that briefly presents the image, then stop.",
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
          "Image size. Allowed values: '1024x1024', '848x1264', '1264x848', '1376x768', '1200x896', '896x1200', '768x1376'. Defaults to '1024x1024'."
        ),
      seed: z
        .number()
        .optional()
        .default(-1)
        .describe(
          'Seed for image generation. Pass -1 (default) to let the model pick a random seed each time — this gives a unique image per request and is recommended. You may pass a specific integer of EXACTLY 10 digits (between 1000000000 and 9999999999) to reproduce a previous image.'
        )
    }),
    async *execute(
      { prompt, size = '1024x1024', seed = -1, image, protectFace = true },
      { toolCallId }
    ) {
      // Normalize the size to one the Space accepts. The seed defaults to -1
      // (the Space's "Random" sentinel) and is always normalized server-side.
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

        const enhancedPrompt = await enhancePrompt(prompt, normalizedSize)

        // Generate with the (enhanced) prompt. If Baidu rejects it for
        // non-compliant content ("内容不合规" / errorCode 40000), retry once
        // with the original user prompt, which is usually shorter and less
        // likely to trip Baidu's content-moderation filter.
        let imageResult: { imageUrl: string; revisedPrompt: string }
        try {
          imageResult = await generateViaGradio(
            enhancedPrompt,
            normalizedSize,
            finalSeed
          )
        } catch (genErr) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr)
          if (/内容不合规|40000|not compliant/i.test(msg)) {
            imageResult = await generateViaGradio(
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
