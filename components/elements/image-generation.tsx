'use client'

import { type ComponentProps,useEffect, useState } from 'react'

import { RefreshCwIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { ghostButton, paper, ShimmerLabel } from './surfaces'

const DOTS = Array.from({ length: 64 }, (_, i) => i)

export function ImageGeneration({
  prompt,
  generating,
  imageUrl,
  errorText,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'prompt' | 'generating'> & {
  prompt: string
  generating: boolean
  imageUrl?: string
  errorText?: string
}) {
  const showImage = Boolean(imageUrl) && !generating
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <div
      data-slot="image-generation"
      className={cn('flex w-96 flex-col gap-2.5', className)}
      {...props}
    >
      <div
        className={cn(
          paper,
          'relative aspect-square w-full overflow-hidden rounded-2xl'
        )}
      >
        <div
          className={cn(
            'absolute inset-0 grid grid-cols-8 place-items-center p-6',
            showImage && 'opacity-0'
          )}
          aria-hidden
        >
          {DOTS.map(dot => {
            const row = Math.floor(dot / 8)
            const col = dot % 8
            return (
              <span
                key={dot}
                className={cn(
                  'bg-foreground/20 size-1 rounded-full transition-opacity duration-500',
                  generating
                    ? 'animate-pulse motion-reduce:animate-none'
                    : 'opacity-0'
                )}
                style={{ animationDelay: `${(row + col) * 90}ms` }}
              />
            )
          })}
        </div>
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 transition-[opacity,filter] duration-1000 ease-out motion-reduce:transition-none',
            generating || showImage ? 'opacity-0 blur-xl' : 'blur-0 opacity-100'
          )}
          style={{
            background:
              'radial-gradient(120% 90% at 20% 100%, oklch(0.45 0.09 265) 0%, transparent 55%), radial-gradient(110% 80% at 85% 90%, oklch(0.62 0.1 300 / 0.8) 0%, transparent 60%), radial-gradient(130% 100% at 60% 0%, oklch(0.88 0.06 60) 0%, oklch(0.74 0.09 25 / 0.9) 45%, transparent 75%), linear-gradient(to top, oklch(0.35 0.06 275), oklch(0.82 0.07 50))'
          }}
        />
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={prompt}
            onClick={() => setIsOpen(true)}
            className="absolute inset-0 size-full cursor-zoom-in object-cover"
          />
        )}
      </div>
      {showImage && isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image agrandie"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setIsOpen(false)}
            className="absolute end-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <XIcon className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={prompt}
            onClick={e => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground/45 min-w-0 flex-1 truncate text-xs">
          {generating ? (
            <ShimmerLabel className="relative">Generating</ShimmerLabel>
          ) : (
            prompt
          )}
        </p>
        <button
          type="button"
          aria-label="Regenerate image"
          className={cn(
            ghostButton,
            'size-6 shrink-0',
            generating && 'pointer-events-none opacity-0'
          )}
        >
          <RefreshCwIcon className="size-3" />
        </button>
      </div>
      {errorText && (
        <p className="text-xs text-destructive">{errorText}</p>
      )}
    </div>
  )
}
