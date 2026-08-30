'use client'

import { type ChangeEvent,useEffect, useRef, useState } from 'react'

import { RefreshCwIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { ghostButton, paper } from './surfaces'

const ALLOWED_SIZES = ['1024x1024', '848x1264', '1264x848'] as const

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ImageEditor({ className }: { className?: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [protectFace, setProtectFace] = useState(true)
  const [size, setSize] = useState<(typeof ALLOWED_SIZES)[number]>('1024x1024')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [lightbox])

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult('')
    setError('')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  async function onSubmit() {
    if (!file) {
      setError('Sélectionne d’abord une image')
      return
    }
    setLoading(true)
    setError('')
    setResult('')
    try {
      const imageData = await fileToBase64(file)

      let finalPrompt = prompt
      if (prompt.trim()) {
        try {
          const enh = await fetch('/api/enhance-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, protectFace })
          })
          const enhData = await enh.json()
          if (enhData?.enhancedPrompt) finalPrompt = enhData.enhancedPrompt
        } catch {
          // fall back to the raw prompt if enhancement fails
        }
      }

      const edit = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, prompt: finalPrompt, size })
      })
      const editData = await edit.json()
      if (editData?.editedImage) {
        setResult(`data:image/png;base64,${editData.editedImage}`)
      } else {
        setError(editData?.error || 'Aucune image retournée')
      }
    } catch (err: any) {
      setError(err?.message || 'Échec de l’édition')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className={cn(paper, 'rounded-2xl p-4')}>
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Upload + preview */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex size-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 text-xs text-muted-foreground hover:border-foreground/40"
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="preview"
                  className="size-full object-cover"
                />
              ) : (
                <span>Ajouter une image</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          {/* Prompt + options */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Décris la transformation (ex. make it anime)"
              className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={protectFace}
                  onChange={e => setProtectFace(e.target.checked)}
                />
                Protéger le visage
              </label>
              <label className="flex items-center gap-2">
                Taille
                <select
                  value={size}
                  onChange={e =>
                    setSize(e.target.value as (typeof ALLOWED_SIZES)[number])
                  }
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  {ALLOWED_SIZES.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || !file}
              className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? 'Génération…' : 'Générer'}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className={cn(paper, 'rounded-2xl p-4')}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Résultat</span>
            <button
              type="button"
              aria-label="Régénérer"
              className={cn(ghostButton, 'size-6')}
              onClick={onSubmit}
            >
              <RefreshCwIcon className="size-3" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result}
            alt="éditée"
            onClick={() => setLightbox(true)}
            className="mt-2 max-h-[60vh] w-full cursor-zoom-in rounded-xl object-contain"
          />
        </div>
      )}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image agrandie"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setLightbox(false)}
            className="absolute end-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <XIcon className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result}
            alt="éditée"
            onClick={e => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
