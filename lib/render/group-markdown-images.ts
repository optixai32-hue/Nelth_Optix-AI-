/**
 * Groups runs of consecutive Markdown image lines (`![alt](url)`) into modern
 * ```spec gallery blocks (Grid + Image), rendered with zoom dialog + credits.
 *
 * - Only complete image-only lines are converted (streaming-safe: a partially
 *   streamed image line stays Markdown until its URL is complete).
 * - Lines inside fenced code blocks are never touched.
 * - Single isolated images are left as Markdown.
 * - Runs are chunked so a gallery holds at most MAX_IMAGES_PER_GALLERY images.
 * - Order is preserved: gallery children follow the Markdown order.
 */

export const MAX_IMAGES_PER_GALLERY = 3

const IMAGE_LINE_RE =
  /^!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)\s*(?:"[^"]*")?\)\s*$/
const FENCE_RE = /^\s*```/

type MarkdownImage = { alt: string; url: string }

function toGallerySpec(images: MarkdownImage[], galleryId: string): string[] {
  const ids = images.map((_, j) => `${galleryId}img${j + 1}`)
  const lines = [
    '```spec',
    JSON.stringify({ op: 'add', path: '/root', value: galleryId }),
    JSON.stringify({
      op: 'add',
      path: `/elements/${galleryId}`,
      value: {
        type: 'Grid',
        props: { columns: images.length, gap: 'sm' },
        children: ids
      }
    })
  ]
  images.forEach((img, j) => {
    lines.push(
      JSON.stringify({
        op: 'add',
        path: `/elements/${ids[j]}`,
        value: {
          type: 'Image',
          props: {
            src: img.url,
            ...(img.alt ? { title: img.alt } : {})
          },
          children: []
        }
      })
    )
  })
  lines.push('```')
  return lines
}

export function groupMarkdownImages(
  text: string,
  maxPerGallery: number = MAX_IMAGES_PER_GALLERY
): string {
  if (!text.includes('![')) return text

  const lines = text.split('\n')
  const out: string[] = []
  let run: MarkdownImage[] = []
  let pendingBlanks: string[] = []
  let inFence = false
  let galleryCount = 0

  const flush = () => {
    if (run.length === 0) {
      out.push(...pendingBlanks)
      pendingBlanks = []
      return
    }
    if (run.length === 1) {
      out.push(`![${run[0].alt}](${run[0].url})`)
    } else {
      for (let i = 0; i < run.length; i += maxPerGallery) {
        galleryCount += 1
        out.push(
          ...toGallerySpec(
            run.slice(i, i + maxPerGallery),
            `gallery${galleryCount}`
          )
        )
      }
    }
    run = []
    // Blank lines collected after the run go back after it (order preserved).
    out.push(...pendingBlanks)
    pendingBlanks = []
  }

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      flush()
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const m = line.match(IMAGE_LINE_RE)
    if (m) {
      run.push({ alt: m[1].trim(), url: m[2] })
      continue
    }
    // Blank lines don't break a run (models often space images out).
    if (line.trim() === '' && run.length > 0) {
      pendingBlanks.push(line)
      continue
    }
    flush()
    out.push(line)
  }
  flush()

  return out.join('\n')
}
