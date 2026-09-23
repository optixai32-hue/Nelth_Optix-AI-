'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconDownload,
  IconPencil,
  IconShare,
  IconTextCaption
} from '@tabler/icons-react'

import { cn } from '@/lib/utils'

type Point = { x: number; y: number }

type DrawAction = {
  kind: 'draw'
  color: string
  widthRel: number
  points: Point[]
}

type TextAction = {
  kind: 'text'
  color: string
  sizeRel: number
  at: Point
  text: string
}

type EditorAction = DrawAction | TextAction

const PALETTE = [
  '#000000',
  '#FF5757',
  '#FFC400',
  '#32C65A',
  '#35A8DD',
  '#A844D8',
  '#9B9B9B'
]

// Canvas follows the SOURCE ratio (never forced): natural size capped,
// displayed fit-to-area preserving proportions.
const MAX_EDGE = 2048

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Export impossible.'))
    }, 'image/png')
  })
}

interface ImageEditorProps {
  src: string
  title?: string
  onClose: () => void
  onSave: (blob: Blob) => void
}

export function ImageEditor({ src, title, onClose, onSave }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLImageElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tool, setTool] = useState<'draw' | 'text'>('draw')
  const [color, setColor] = useState(PALETTE[1])
  const [actions, setActions] = useState<EditorAction[]>([])
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<(Point & { value: string }) | null>(null)
  const cancelDraftRef = useRef(false)
  const drawingRef = useRef<Point[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load the base image (CORS-clean so export never taints when possible).
  // Backing store keeps the source proportions (capped), display scales
  // to fit — never stretched, never force-cropped.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setLoadError(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      const scale =
        Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight)) ||
        1
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      }
      baseRef.current = img
      setActions([])
      setStep(0)
      setDraft(null)
      setReady(true)
    }
    img.onerror = () => {
      if (!cancelled) setLoadError('Image illisible.')
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  // Repaint base + applied actions.
  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    const base = baseRef.current
    if (!canvas || !base) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
    const applied = actions.slice(0, step)
    for (const action of applied) {
      if (action.kind === 'draw') {
        if (action.points.length === 0) continue
        ctx.strokeStyle = action.color
        ctx.lineWidth = Math.max(1, action.widthRel * canvas.width)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        action.points.forEach((p, i) => {
          const x = p.x * canvas.width
          const y = p.y * canvas.height
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      } else {
        const px = Math.max(12, action.sizeRel * canvas.width)
        ctx.fillStyle = action.color
        ctx.font = `600 ${px}px Arial, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
          action.text,
          action.at.x * canvas.width,
          action.at.y * canvas.height
        )
      }
    }
  }, [actions, step])

  useEffect(() => {
    repaint()
  }, [repaint, ready])

  // Escape closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toRelative = (e: React.PointerEvent): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    }
  }

  const pushAction = (action: EditorAction) => {
    setActions(prev => [...prev.slice(0, step), action])
    setStep(prev => prev + 1)
  }

  const undo = () => setStep(s => Math.max(0, s - 1))
  const redo = () => setStep(s => Math.min(actions.length, s + 1))

  const commitDraft = (value: string) => {
    if (cancelDraftRef.current) {
      cancelDraftRef.current = false
      setDraft(null)
      return
    }
    const text = value.trim()
    setDraft(null)
    if (!text || !draft) return
    pushAction({
      kind: 'text',
      color,
      sizeRel: 0.05,
      at: { x: draft.x, y: draft.y },
      text
    })
  }

  const exportBlob = async (): Promise<Blob> => {
    const canvas = canvasRef.current
    if (!canvas || !ready) throw new Error('Image pas prête.')
    try {
      return await canvasToBlob(canvas)
    } catch {
      throw new Error('Export bloqué (CORS).')
    }
  }

  const handleDownload = async () => {
    try {
      const blob = await exportBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title || 'image').slice(0, 40)}-edite.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export impossible.')
    }
  }

  const handleCopy = async () => {
    try {
      const blob = await exportBlob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copie impossible.')
    }
  }

  const handleShare = async () => {
    try {
      const blob = await exportBlob()
      const file = new File([blob], 'image-editee.png', { type: 'image/png' })
      if (
        typeof navigator.share === 'function' &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({ files: [file] })
        return
      }
      throw new Error('Partage non supporté ici.')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Partage impossible.')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const blob = await exportBlob()
      onSave(blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export impossible.')
      setSaving(false)
    }
  }

  // Display caps from the loaded natural size (recomputed every render
  // once ready): landscape 900×500, portrait 420×500, square 500×500.
  // Viewport-relative (100vw/100dvh are always definite, unlike container
  // percentages which resolve circularly and let the image blow up).
  const nat = baseRef.current
  const [capW, capH] =
    nat && nat.naturalWidth && nat.naturalHeight
      ? nat.naturalWidth > nat.naturalHeight
        ? [1000, 560]
        : nat.naturalWidth < nat.naturalHeight
          ? [460, 560]
          : [560, 560]
      : [1000, 560]

  if (!mounted) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Éditeur d’image'}
      className="fixed inset-0 z-[70] flex h-[100dvh] flex-col overflow-hidden overscroll-contain [font-family:Arial,sans-serif]"
      style={{
        background:
          'radial-gradient(circle at 50% 40%, #252525 0%, #1c1c1c 55%, #151515 100%)'
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 p-3 md:p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Retour"
          title="Retour"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-200 transition-colors hover:bg-white/10"
        >
          <IconArrowBackUp size={20} />
        </button>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => void handleShare()}
            aria-label="Partager"
            title="Partager"
            className="flex size-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconShare size={19} />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copier"
            title="Copier"
            className="flex size-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconCopy
              size={19}
              className={copied ? 'text-emerald-400' : undefined}
            />
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            aria-label="Télécharger"
            title="Télécharger"
            className="flex size-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconDownload size={19} />
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={step === 0}
            aria-label="Annuler"
            title="Annuler"
            className="flex size-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <IconArrowBackUp size={19} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={step >= actions.length}
            aria-label="Rétablir"
            title="Rétablir"
            className="flex size-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <IconArrowForwardUp size={19} />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
          >
            Enregistrer
          </button>
        </div>
      </div>

      {error && (
        <p className="px-4 pb-2 text-center text-sm text-red-400">{error}</p>
      )}

      {/* Center image — follows the source ratio, fit to the area
          (never zoomed/cropped/stretched), flex-centered with dark
          margins all around. Absolute viewport caps (not container
          percentages, which resolve circularly and let the image blow
          up): landscape 900×500, portrait 420×500, square 500×500. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pt-5 md:px-10">
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: `min(${capW}px, calc(100vw - 64px))`,
              maxHeight: `min(${capH}px, calc(100dvh - 320px))`
            }}
            onPointerDown={e => {
              if (!ready) return
              const p = toRelative(e)
              if (!p) return
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
              if (tool === 'draw') {
                drawingRef.current = [p]
              } else {
                cancelDraftRef.current = false
                setDraft({ ...p, value: '' })
              }
            }}
            onPointerMove={e => {
              if (tool !== 'draw' || !drawingRef.current || !ready) return
              const p = toRelative(e)
              if (!p) return
              drawingRef.current = [...drawingRef.current, p]
              // Live preview: paint base + applied + in-progress stroke.
              const canvas = canvasRef.current
              const base = baseRef.current
              if (!canvas || !base) return
              repaint()
              const ctx = canvas.getContext('2d')
              if (!ctx) return
              const pts = drawingRef.current
              ctx.strokeStyle = color
              ctx.lineWidth = Math.max(1, 0.006 * canvas.width)
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              ctx.beginPath()
              pts.forEach((pt, i) => {
                const x = pt.x * canvas.width
                const y = pt.y * canvas.height
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              })
              ctx.stroke()
            }}
            onPointerUp={() => {
              const pts = drawingRef.current
              drawingRef.current = null
              if (tool === 'draw' && pts && pts.length > 0) {
                pushAction({
                  kind: 'draw',
                  color,
                  widthRel: 0.006,
                  points: pts
                })
              }
            }}
            onPointerCancel={() => {
              drawingRef.current = null
              repaint()
            }}
            className={cn(
              'block h-auto w-auto touch-none',
              tool === 'draw' ? 'cursor-crosshair' : 'cursor-text'
            )}
          />
          {draft && (
            <input
              autoFocus
              value={draft.value}
              onChange={e => setDraft({ ...draft, value: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') commitDraft(draft.value)
                if (e.key === 'Escape') {
                  cancelDraftRef.current = true
                  setDraft(null)
                }
              }}
              onBlur={() => commitDraft(draft.value)}
              placeholder="Texte…"
              aria-label="Texte à placer"
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-black/60 px-2 py-1 text-sm text-white outline-none placeholder:text-neutral-400"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                color
              }}
            />
          )}
        </div>
      </div>

      {/* Palette */}
      <div className="flex items-center justify-center gap-5 px-4 pt-4">
        {PALETTE.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Couleur ${c}`}
            aria-pressed={color === c}
            style={{ backgroundColor: c }}
            className={cn(
              'size-5 shrink-0 rounded-full transition-transform hover:scale-110',
              c === '#000000' && 'border border-white/25',
              color === c && 'ring-2 ring-white ring-offset-2 ring-offset-black'
            )}
          />
        ))}
      </div>

      {/* Tools */}
      <div className="flex items-start justify-center gap-8 px-4 pb-8 pt-4">
        <button
          type="button"
          onClick={() => setTool('draw')}
          aria-pressed={tool === 'draw'}
          className="flex flex-col items-center gap-1.5"
        >
          <span
            className={cn(
              'flex size-12 items-center justify-center rounded-full transition-colors',
              tool === 'draw'
                ? 'bg-white text-black'
                : 'bg-neutral-800 text-neutral-300'
            )}
          >
            <IconPencil size={22} />
          </span>
          <span className="text-[13px] text-neutral-400">Dessin</span>
        </button>
        <button
          type="button"
          onClick={() => setTool('text')}
          aria-pressed={tool === 'text'}
          className="flex flex-col items-center gap-1.5"
        >
          <span
            className={cn(
              'flex size-12 items-center justify-center rounded-full transition-colors',
              tool === 'text'
                ? 'bg-white text-black'
                : 'bg-neutral-800 text-neutral-300'
            )}
          >
            <IconTextCaption size={22} />
          </span>
          <span className="text-[13px] text-neutral-400">Texte</span>
        </button>
      </div>

      {/* Bottom breathing room (the prompt composer lives in the main
          views and returns when going back). */}
      <div className="h-6 shrink-0" aria-hidden />
    </div>,
    document.body
  )
}
