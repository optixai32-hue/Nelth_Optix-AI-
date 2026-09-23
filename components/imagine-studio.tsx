'use client'

import { useEffect, useRef, useState } from 'react'

import {
  IconArrowLeft,
  IconExternalLink,
  IconLayoutGrid,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconRectangleVertical,
  IconSparkles,
  IconVideo,
  IconVolumeOff
} from '@tabler/icons-react'
import { ArrowUp, X } from 'lucide-react'

import { cn } from '@/lib/utils'

type StudioMode = 'image' | 'video'
type AspectRatio = '1:1' | '16:9' | '9:16'
type VideoResolution = '480p' | '720p'
type VideoDuration = '6s' | '10s'

export interface ImagineParams {
  mode: StudioMode
  prompt: string
  aspectRatio: AspectRatio
  resolution: VideoResolution
  duration: VideoDuration
  style: string | null
  variations: number
  sourceImageEntId: string | null
}

export interface StudioAttachment {
  id: string
  name: string
  previewUrl: string
  status: 'uploading' | 'ready' | 'error'
  error?: string
  ent?: {
    sourceImageEntId: string
    mediaEntId: string
    imageUrl: string
    allMediaEntIds: Array<{ accountIndex: number; mediaEntId: string }>
  }
}

export interface ComposerExtras {
  variations: number
  setVariations: (n: number) => void
  variationsLocked: boolean
  attachmentBar: React.ReactNode
  onAttach: () => void
  canSend: boolean
}

interface ImagineStudioProps {
  onGenerate?: (params: ImagineParams) => void
}

// ---------------------------------------------------------------------------
// Small building blocks (pixel spec: 752px composer, 22px radius, toolbar)
// ---------------------------------------------------------------------------

function ToolbarIconButton({
  label,
  onClick,
  children,
  className
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10',
        className
      )}
    >
      {children}
    </button>
  )
}

function ModeCapsule({
  active,
  onClick,
  label,
  icon,
  wide
}: {
  active?: boolean
  onClick?: () => void
  label: string
  icon: React.ReactNode
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-[38px] shrink-0 items-center gap-1.5 rounded-[18px] px-3 text-[14px] font-medium transition-colors',
        wide && 'min-w-[70px] justify-center',
        active
          ? 'border border-black/5 bg-white text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.10)] dark:border-white/10 dark:bg-background dark:text-foreground'
          : 'text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabledValues = [],
  disabledHint
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  disabledValues?: readonly T[]
  disabledHint?: string
}) {
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-1 rounded-[20px] bg-neutral-100 p-1 dark:bg-muted">
      {options.map(option => {
        const isActive = option === value
        const isDisabled = disabledValues.includes(option) && !isActive
        return (
          <button
            key={option}
            type="button"
            disabled={isDisabled}
            title={isDisabled ? disabledHint : option}
            onClick={() => onChange(option)}
            className={cn(
              'flex h-full items-center justify-center rounded-[16px] px-3 text-[14px] transition-colors',
              isActive
                ? 'bg-white font-medium text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.10)] dark:bg-background dark:text-foreground'
                : 'text-neutral-500 dark:text-neutral-400',
              !isActive &&
                !isDisabled &&
                'hover:bg-black/5 dark:hover:bg-white/10',
              isDisabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Imagine studio (frontend only — backend wiring comes later)
// ---------------------------------------------------------------------------

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16']
const VIDEO_RESOLUTIONS: VideoResolution[] = ['480p', '720p']
const VIDEO_DURATIONS: VideoDuration[] = ['6s', '10s']

// ---------------------------------------------------------------------------
// Variations selector (1-4, default 2). Locked to 1 when an image is
// attached (the request becomes image-to-image / image-to-video).
// ---------------------------------------------------------------------------

function VariationsSelect({
  value,
  onChange,
  locked
}: {
  value: number
  onChange: (n: number) => void
  locked: boolean
}) {
  return (
    <div
      title={locked ? 'Fixé à 1 avec une image' : 'Variations'}
      className="flex h-[38px] shrink-0 items-center gap-0.5 rounded-[19px] bg-neutral-100 p-1 dark:bg-muted"
    >
      {[1, 2, 3, 4].map(n => (
        <button
          key={n}
          type="button"
          disabled={locked}
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          aria-label={`${n} variation${n > 1 ? 's' : ''}`}
          className={cn(
            'flex size-[30px] items-center justify-center rounded-full text-[13px] transition-colors',
            value === n
              ? 'bg-white font-semibold text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.10)] dark:bg-background dark:text-foreground'
              : 'text-neutral-500 dark:text-neutral-400',
            !locked && value !== n && 'hover:bg-black/5 dark:hover:bg-white/10',
            locked && 'cursor-not-allowed opacity-60'
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attached source image chip (thumbnail + upload status + remove).
// ---------------------------------------------------------------------------

function AttachmentBar({
  attachment,
  onRemove
}: {
  attachment: StudioAttachment | null
  onRemove: () => void
}) {
  if (!attachment) return null
  return (
    <div className="flex items-center gap-2 px-[19px] pt-3">
      <div className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-black/5 bg-neutral-100 dark:border-white/10 dark:bg-white/10">
        {attachment.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.previewUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : null}
        {attachment.status === 'uploading' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <IconLoader2 size={14} className="animate-spin text-white" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-[#111] dark:text-foreground">
          {attachment.name}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {attachment.status === 'uploading'
            ? 'Envoi…'
            : attachment.status === 'ready'
              ? 'Prête — variations fixées à 1'
              : (attachment.error ?? 'Échec de l’envoi.')}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Retirer l’image"
        className="shrink-0 rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-black/5 hover:text-foreground dark:text-neutral-400"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Style preset grid (Whisk-style): dense compact cards, image cover,
// bottom gradient, white label. Thumbnails via picsum seeds until the
// backend serves real style artwork.
// ---------------------------------------------------------------------------

const STYLE_PRESETS = [
  'Mug',
  'Neon',
  'Arcade',
  'Peluches',
  'Parachute',
  'Chibi',
  'Studio',
  'Bois',
  'Hollywood',
  'Pâte à modeler',
  'Yoga',
  'Floraison',
  'Zen',
  'Premier rang',
  'Pastel',
  'Sitcom Star',
  'Origami',
  'Attrape-peluche',
  'Monstera',
  'Gigascale',
  'Fresque',
  'Photo CV',
  'Sur un banc',
  'Élifique',
  'Aquarelle',
  'Pins',
  'NYC',
  'Peinture murale',
  'Afrique années 70',
  'Bento',
  'Marbre',
  'Parc d\u2019attractions',
  'Pop-up',
  'Bronze'
]

function StylePresetGrid({
  active,
  onSelect,
  expanded,
  onToggle
}: {
  active: string | null
  onSelect: (label: string) => void
  expanded: boolean
  onToggle: () => void
}) {
  // Collapsed: first 17 presets + a "Plus" card; expanded: all 34 + Fermer.
  const visible = expanded ? STYLE_PRESETS : STYLE_PRESETS.slice(0, 17)
  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
      {visible.map(label => {
        const isActive = active === label
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(label)}
            aria-pressed={isActive}
            title={label}
            className={cn(
              'group relative aspect-[60/86] w-full overflow-hidden rounded-[18px] bg-neutral-200 transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-md dark:bg-white/10',
              isActive && 'shadow-lg ring-2 ring-white'
            )}
          >
            <img
              src={`https://picsum.photos/seed/${encodeURIComponent(label)}/280/400`}
              alt={label}
              loading="lazy"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/65 via-black/20 to-transparent"
            />
            <span className="absolute bottom-[8px] left-[8px] right-[8px] text-left text-[12px] font-semibold leading-tight text-white">
              {label}
            </span>
          </button>
        )
      })}
      {/* Trailing card — Fermer collapses to 17 + Plus, Plus expands
          back to the full 34. Same shape, no image. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex aspect-[60/86] w-full flex-col items-center justify-center gap-1 rounded-[18px] bg-[#F1F1F1] text-[#555555] transition-transform duration-150 ease-out hover:scale-[1.04] dark:bg-white/10 dark:text-neutral-400"
      >
        {expanded ? (
          <X size={20} strokeWidth={2} />
        ) : (
          <IconPlus size={20} strokeWidth={2} />
        )}
        <span className="text-xs font-medium">
          {expanded ? 'Fermer' : 'Plus'}
        </span>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Style preview card (Gemini/ChatGPT-like): click a preset → lightbox with
// the image, its title and actions (use style, open original, send).
// ---------------------------------------------------------------------------

function StylePreviewCard({
  label,
  onUse,
  onSend,
  onClose
}: {
  label: string
  onUse: () => void
  onSend: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fullUrl = `https://picsum.photos/seed/${encodeURIComponent(label)}/800/1000`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-[20px] bg-white shadow-2xl dark:bg-card"
      >
        <div className="relative">
          <img
            src={fullUrl}
            alt={label}
            draggable={false}
            className="aspect-[4/3] w-full object-cover"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aperçu"
            className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center gap-2 p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-[#111] dark:text-foreground">
              {label}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Preset de style
            </p>
          </div>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Voir l'original"
            title="Voir l'original"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10"
          >
            <IconExternalLink size={17} />
          </a>
          <button
            type="button"
            onClick={onUse}
            className="shrink-0 rounded-full border border-black/10 px-3.5 py-2 text-[13px] font-medium text-[#111] transition-colors hover:bg-black/5 dark:border-white/15 dark:text-foreground dark:hover:bg-white/10"
          >
            Utiliser
          </button>
          <button
            type="button"
            onClick={onSend}
            aria-label="Envoyer"
            title="Envoyer"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95 dark:bg-white dark:text-black"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Découvrir composer — matches the Découvrir reference twin of the studio
// toolbar: quality pills (Vitesse / Qualité 2.0), mic, pastel-blue CTA.
// ---------------------------------------------------------------------------

interface DiscoverComposerProps {
  prompt: string
  setPrompt: (v: string) => void
  mode: StudioMode
  setMode: (m: StudioMode) => void
  aspectRatio: AspectRatio
  cycleAspectRatio: () => void
  resolution: VideoResolution
  setResolution: (r: VideoResolution) => void
  duration: VideoDuration
  setDuration: (d: VideoDuration) => void
  generating: boolean
  onGenerate: () => void
  extras: ComposerExtras
}

function DiscoverComposer({
  prompt,
  setPrompt,
  mode,
  setMode,
  aspectRatio,
  cycleAspectRatio,
  resolution,
  setResolution,
  duration,
  setDuration,
  generating,
  onGenerate,
  extras
}: DiscoverComposerProps) {
  return (
    <>
      <div className="w-full overflow-hidden rounded-[24px] border border-[#e5e5e5] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:border-border dark:bg-card">
        {extras.attachmentBar}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onGenerate()
            }
          }}
          placeholder="Décrivez ce que vous imaginez"
          rows={1}
          className="min-h-[48px] w-full resize-none bg-transparent px-[19px] pt-[16px] text-[16px] leading-[22px] text-[#111] outline-none placeholder:text-[#707070] dark:text-foreground"
        />
        <div className="no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto px-[15px] pt-[6px] pb-[11px] md:flex-wrap md:gap-3 md:overflow-visible md:px-[19px]">
          <ToolbarIconButton
            label="Ajouter"
            className="-ml-2"
            onClick={extras.onAttach}
          >
            <IconPlus size={20} strokeWidth={2} />
          </ToolbarIconButton>
          {mode === 'image' ? (
            <>
              <ModeCapsule
                active
                label="Image"
                icon={<IconPhoto size={15} />}
              />
              <ToolbarIconButton
                label="Mode vidéo"
                onClick={() => setMode('video')}
              >
                <IconVideo size={20} />
              </ToolbarIconButton>
              <ToolbarIconButton label="Médias">
                <IconLayoutGrid size={19} />
              </ToolbarIconButton>
            </>
          ) : (
            <>
              <ToolbarIconButton
                label="Mode image"
                onClick={() => setMode('image')}
              >
                <IconPhoto size={20} />
              </ToolbarIconButton>
              <ModeCapsule
                active
                wide
                label="Vidéo"
                icon={
                  <IconVideo
                    size={16}
                    className="text-black dark:text-foreground"
                  />
                }
              />
              <ToolbarIconButton label="Médias">
                <IconLayoutGrid size={19} />
              </ToolbarIconButton>
              <div className="hidden md:contents">
                <SegmentedControl
                  options={VIDEO_RESOLUTIONS}
                  value={resolution}
                  onChange={setResolution}
                />
              </div>
              <div className="hidden md:contents">
                <SegmentedControl
                  options={VIDEO_DURATIONS}
                  value={duration}
                  onChange={setDuration}
                  disabledValues={['10s']}
                  disabledHint="Bientôt disponible"
                />
              </div>
              <ToolbarIconButton label="Audio (bientôt disponible)">
                <IconVolumeOff size={18} />
              </ToolbarIconButton>
            </>
          )}
          {/* No ratio in edit/animate mode — the source image decides. */}
          {!extras.variationsLocked && (
            <button
              type="button"
              onClick={cycleAspectRatio}
              title="Format d'image"
              className="flex h-[39px] w-[63px] shrink-0 items-center justify-center gap-1.5 rounded-[20px] bg-neutral-100 text-[14px] text-[#111] transition-colors hover:bg-neutral-200/70 dark:bg-muted dark:text-foreground dark:hover:bg-white/10"
            >
              <IconRectangleVertical size={14} />
              {aspectRatio}
            </button>
          )}
          <VariationsSelect
            value={extras.variationsLocked ? 1 : extras.variations}
            onChange={extras.setVariations}
            locked={extras.variationsLocked}
          />
          <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1 bg-white pl-1 dark:bg-card">
            <button
              type="button"
              onClick={onGenerate}
              aria-label="Générer"
              title="Générer"
              disabled={!extras.canSend}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {generating ? (
                <IconLoader2 size={18} className="animate-spin" />
              ) : (
                <ArrowUp size={18} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
      {mode === 'video' && (
        <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2 md:hidden">
          <SegmentedControl
            options={VIDEO_RESOLUTIONS}
            value={resolution}
            onChange={setResolution}
          />
          <SegmentedControl
            options={VIDEO_DURATIONS}
            value={duration}
            onChange={setDuration}
            disabledValues={['10s']}
            disabledHint="Bientôt disponible"
          />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Découvrir view: back nav + upgrade pill, user badge, two 2:3 cards
// (loading grain → results), floating composer. Shown with animation
// right when the user sends a prompt.
// ---------------------------------------------------------------------------

export interface ImagineResult {
  kind: 'image' | 'video'
  url: string
  prompt: string
  /** True for fbcdn URLs (video + uncleaned images) that expire (~1h). */
  temporary?: boolean
}

function DiscoverCard({
  result,
  loading
}: {
  result?: ImagineResult | null
  loading: boolean
}) {
  return (
    <div className="group relative aspect-[2/3] w-full overflow-hidden rounded-[4px] bg-[#f5f5f5] transition-all duration-150 ease-out hover:scale-[1.02] hover:shadow-lg dark:bg-white/5">
      {result?.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={result.url}
          src={result.url}
          alt=""
          draggable={false}
          className="discover-card-in absolute inset-0 h-full w-full object-cover"
        />
      ) : result?.kind === 'video' ? (
        <>
          <video
            key={result.url}
            src={result.url}
            controls
            playsInline
            preload="metadata"
            className="discover-card-in absolute inset-0 h-full w-full object-cover"
          />
          <span className="pointer-events-none absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white">
            <IconVideo size={14} />
          </span>
        </>
      ) : (
        <div
          className={cn(
            'noise-placeholder absolute inset-0',
            loading && 'shimmer-loading'
          )}
        />
      )}
      {result?.temporary ? (
        <span
          title="URL temporaire (~1h)"
          className="pointer-events-none absolute right-2 top-2 rounded-full bg-amber-100/95 px-2 py-0.5 text-[10px] font-medium text-amber-700"
        >
          Temporaire
        </span>
      ) : null}
    </div>
  )
}

function DiscoverView({
  onBack,
  onRetry,
  results,
  expected,
  working,
  status,
  error,
  composer
}: {
  onBack: () => void
  onRetry: () => void
  results: ImagineResult[]
  expected: number
  working: boolean
  status: string | null
  error: string | null
  composer: React.ReactNode
}) {
  return (
    <div className="flex min-h-full w-full flex-col bg-[#fafafa] [font-family:Arial,sans-serif] dark:bg-background">
      <div className="sticky top-0 z-20 flex items-center justify-between bg-[#fafafa]/85 px-3 pb-3 pt-16 backdrop-blur-md md:px-6 md:pt-3 dark:bg-background/85">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            title="Retour"
            className="flex size-10 items-center justify-center rounded-full bg-[#f1f1f1] text-black transition-transform hover:scale-105 active:scale-95 dark:bg-white/10 dark:text-foreground"
          >
            <IconArrowLeft size={18} />
          </button>
          <span className="select-none text-[16px] font-semibold text-[#171717] dark:text-foreground">
            Découvrir
          </span>
        </div>
        <button
          type="button"
          title="Bientôt disponible"
          className="flex h-[36px] items-center gap-1.5 rounded-full bg-[#D9E7FF] px-4 text-[13px] font-medium text-[#5D769C] transition hover:brightness-[0.97] dark:bg-[#D9E7FF]/15 dark:text-[#9db4d4]"
        >
          <IconSparkles size={15} />
          <span className="hidden sm:inline">Mettre à niveau</span>
          <span className="sm:hidden">Pro</span>
        </button>
      </div>
      <div className="pl-4 pr-4 pt-[6px] md:pl-14">
        <div className="flex size-[42px] select-none items-center justify-center rounded-full bg-[#f1f1f1] text-xs text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
          ug
        </div>
      </div>
      {(status || error) && (
        <div className="pl-4 pr-4 pt-3 md:pl-14">
          {status && !error ? (
            <div className="flex cursor-default select-none flex-row items-center gap-2 text-[14px] text-neutral-600 dark:text-neutral-300">
              <IconLoader2 size={16} className="animate-spin" />
              <span>{status}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-[13px] font-medium text-[#111] transition-colors hover:bg-black/5 dark:border-white/15 dark:text-foreground dark:hover:bg-white/10"
              >
                Réessayer
              </button>
            </div>
          ) : null}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 pl-4 pr-4 pt-3 md:grid-cols-3 md:pl-14 xl:grid-cols-4">
        {Array.from({ length: Math.max(1, expected) }).map((_, i) => (
          <DiscoverCard key={i} result={results[i] ?? null} loading={working} />
        ))}
      </div>
      <div className="sticky bottom-4 z-10 mx-auto mt-8 w-full max-w-[750px] px-4 pb-2">
        {composer}
      </div>
      <div className="pb-4" />
    </div>
  )
}

export function ImagineStudio({ onGenerate }: ImagineStudioProps) {
  const [mode, setMode] = useState<StudioMode>('image')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] = useState<VideoResolution>('480p')
  const [duration, setDuration] = useState<VideoDuration>('6s')
  const [style, setStyle] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [view, setView] = useState<'create' | 'discover'>('create')
  const [expectedCount, setExpectedCount] = useState(2)
  const [variations, setVariations] = useState(2)
  const [attachment, setAttachment] = useState<StudioAttachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [generating, setGenerating] = useState(false)
  const [job, setJob] = useState<
    | { status: 'working'; label: string }
    | { status: 'error'; message: string }
    | null
  >(null)
  const [results, setResults] = useState<ImagineResult[]>([])
  const busyRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Effective variations: locked to 1 as soon as a source image is
  // attached (the request becomes image-to-image / image-to-video).
  const variationsLocked = attachment?.status === 'ready'
  const effectiveVariations = variationsLocked ? 1 : variations
  // Send allowed with prompt text — or empty for auto-animate (attached
  // image + video mode, motion directive optional).
  const canSend =
    !generating &&
    attachment?.status !== 'uploading' &&
    (prompt.trim().length > 0 || (mode === 'video' && variationsLocked))

  // Stop any pending video poll on unmount.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  const cycleAspectRatio = () => {
    setAspectRatio(
      prev =>
        ASPECT_RATIOS[(ASPECT_RATIOS.indexOf(prev) + 1) % ASPECT_RATIOS.length]
    )
  }

  const withStyle = (text: string, styleOverride: string | null) =>
    styleOverride ? `${text} (${styleOverride} style)` : text

  // Watermark removal + logo via our clean proxy, returned as a session
  // blob URL (browser-local, no ImageKit). Throws on failure so callers
  // can fall back to the raw fbcdn URL.
  const cleanToBlobUrl = async (fbcdnUrl: string): Promise<string> => {
    const res = await fetch('/api/imagine/images/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: fbcdnUrl })
    })
    if (!res.ok) throw new Error('Nettoyage impossible.')
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  const MAX_IMAGE_BYTES = 3 * 1024 * 1024

  // Downscale hero photos client-side so the upload stays small and fast:
  // files ≤1.5Mo go through untouched, bigger ones are resized (max 1920px,
  // JPEG 0.85). Without this, phone photos blow past the serverless body
  // limit (HTTP 413) or stall the 4-account upload past its timeout.
  const prepareImageForUpload = (file: File): Promise<{ base64: string }> =>
    new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Lecture impossible.'))
      if (file.size <= 1536 * 1024) {
        const reader = new FileReader()
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          const comma = result.indexOf(',')
          resolve({ base64: comma >= 0 ? result.slice(comma + 1) : result })
        }
        reader.onerror = fail
        reader.readAsDataURL(file)
        return
      }
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, 1920 / Math.max(img.width, img.height)) || 1
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fail()
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        const comma = dataUrl.indexOf(',')
        resolve({ base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        fail()
      }
      img.src = url
    })

  const handleRemoveAttachment = () => {
    setAttachment(prev => {
      if (prev?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl)
      }
      return null
    })
  }

  const handleAttachFile = async (file: File) => {
    handleRemoveAttachment()
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`
    if (!file.type.startsWith('image/')) {
      setAttachment({
        id,
        name: file.name,
        previewUrl: '',
        status: 'error',
        error: 'Image uniquement.'
      })
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachment({
        id,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        status: 'error',
        error: 'Image trop lourde (max 3 Mo).'
      })
      return
    }
    setAttachment({
      id,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading'
    })
    try {
      const { base64 } = await prepareImageForUpload(file)
      const res = await fetch('/api/imagine/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, filename: file.name })
      })
      const json = (await res.json().catch(() => null)) as {
        sourceImageEntId?: string
        mediaEntId?: string
        imageUrl?: string
        allMediaEntIds?: Array<{ accountIndex: number; mediaEntId: string }>
        error?: string
      } | null
      if (
        !res.ok ||
        !json?.sourceImageEntId ||
        !json?.mediaEntId ||
        !json?.imageUrl
      ) {
        throw new Error(
          json?.error ||
            (res.status === 413
              ? 'Image trop lourde pour l’envoi.'
              : `L'envoi a échoué (${res.status}).`)
        )
      }
      setAttachment(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              status: 'ready',
              ent: {
                sourceImageEntId: json.sourceImageEntId!,
                mediaEntId: json.mediaEntId!,
                imageUrl: json.imageUrl!,
                allMediaEntIds: json.allMediaEntIds ?? []
              }
            }
          : prev
      )
    } catch (err) {
      setAttachment(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              status: 'error',
              error: err instanceof Error ? err.message : "L'envoi a échoué."
            }
          : prev
      )
    }
  }

  const runGeneration = async (params: {
    mode: StudioMode
    prompt: string
    aspectRatio: AspectRatio
    resolution: VideoResolution
    style: string | null
  }) => {
    const text = params.prompt.trim()
    const ent = attachment?.status === 'ready' ? attachment.ent! : null
    const count = ent ? 1 : variations
    if ((!text && !(ent && params.mode === 'video')) || busyRef.current) return
    // External handler (embedding) takes over entirely when provided.
    if (onGenerate) {
      onGenerate({
        ...params,
        prompt: text,
        duration,
        variations: count,
        sourceImageEntId: ent?.sourceImageEntId ?? null
      })
      return
    }
    // Swap to the Découvrir view with its loading cards (animated).
    setView('discover')
    setExpectedCount(count)
    busyRef.current = true
    setGenerating(true)
    setJob(null)
    try {
      const fullPrompt = withStyle(text, params.style)
      // Attached source image → image-to-image edit (auto-enhanced
      // server-side) or image-to-video animate. Variations locked to 1.
      if (ent && params.mode === 'image') {
        setJob({ status: 'working', label: 'Édition de l’image…' })
        const res = await fetch('/api/imagine/images/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceImageEntId: ent.sourceImageEntId,
            editPrompt: fullPrompt,
            allMediaEntIds: ent.allMediaEntIds
          })
        })
        const json = (await res.json().catch(() => null)) as {
          contentItem?: { imageUrl: string }
          usedPrompt?: string
          error?: string
        } | null
        if (!res.ok || !json?.contentItem?.imageUrl) {
          throw new Error(json?.error || "L'édition a échoué.")
        }
        setJob({ status: 'working', label: 'Nettoyage…' })
        let editUrl = json.contentItem.imageUrl
        let editTemporary = true
        try {
          editUrl = await cleanToBlobUrl(json.contentItem.imageUrl)
          editTemporary = false
        } catch {
          // Fallback: raw fbcdn URL stays visible (~1h).
        }
        setResults(prev => [
          {
            kind: 'image' as const,
            url: editUrl,
            prompt: json.usedPrompt || text,
            temporary: editTemporary
          },
          ...prev
        ])
        setJob(null)
        return
      }
      // Batch starter (text-to-x or animate): returns a batchId, then poll.
      let batchId: string
      if (ent) {
        setJob({ status: 'working', label: 'Animation de l’image…' })
        const res = await fetch('/api/imagine/videos/animate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: {
              id: ent.mediaEntId,
              imageUrl: ent.imageUrl,
              mediaEntId: ent.mediaEntId
            },
            ...(text ? { motion: fullPrompt } : {})
          })
        })
        const json = (await res.json().catch(() => null)) as {
          batchId?: string
          error?: string
        } | null
        if (!res.ok || !json?.batchId) {
          throw new Error(json?.error || "L'animation a échoué.")
        }
        batchId = json.batchId
      } else if (params.mode === 'image') {
        setJob({ status: 'working', label: 'Génération de l’image…' })
        const res = await fetch('/api/imagine/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            aspectRatio: params.aspectRatio,
            variations: count
          })
        })
        const json = (await res.json().catch(() => null)) as {
          data?: Array<{ url: string }>
          error?: string
        } | null
        if (!res.ok || !json?.data?.length) {
          throw new Error(json?.error || 'La génération a échoué.')
        }
        setJob({ status: 'working', label: 'Nettoyage…' })
        const cleaned = await Promise.all(
          json.data!.map(async d => {
            try {
              return {
                url: await cleanToBlobUrl(d.url),
                temporary: false
              }
            } catch {
              // Fallback: raw fbcdn URL stays visible (~1h).
              return { url: d.url, temporary: true }
            }
          })
        )
        setResults(prev => [
          ...cleaned.map(c => ({
            kind: 'image' as const,
            url: c.url,
            prompt: text,
            temporary: c.temporary
          })),
          ...prev
        ])
        setJob(null)
        return
      } else {
        setJob({ status: 'working', label: 'Démarrage de la vidéo…' })
        const res = await fetch('/api/imagine/videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            aspectRatio: params.aspectRatio,
            resolution: params.resolution,
            variations: count
          })
        })
        const json = (await res.json().catch(() => null)) as {
          batchId?: string
          error?: string
        } | null
        if (!res.ok || !json?.batchId) {
          throw new Error(json?.error || 'La génération a échoué.')
        }
        batchId = json.batchId
      }
      {
        // Poll every 5s (backend timeout=5s) until enough videoUrls land.
        let attempt = 0
        const poll = async (): Promise<void> => {
          attempt += 1
          if (attempt > 60) throw new Error('Délai dépassé, réessaie.')
          setJob({
            status: 'working',
            label: `Génération vidéo… (${attempt})`
          })
          const pollRes = await fetch('/api/imagine/videos/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId })
          })
          const pollJson = (await pollRes.json().catch(() => null)) as {
            batch?: {
              isComplete?: boolean
              content?: Array<{ videoUrl?: string | null }>
            }
            error?: string
          } | null
          if (!pollRes.ok || !pollJson?.batch) {
            throw new Error(pollJson?.error || 'Le suivi a échoué.')
          }
          const urls = [
            ...new Set(
              (pollJson.batch.content ?? []).flatMap(c =>
                typeof c.videoUrl === 'string' && c.videoUrl.length > 0
                  ? [c.videoUrl]
                  : []
              )
            )
          ]
          if (urls.length >= count || pollJson.batch.isComplete) {
            if (urls.length === 0) throw new Error('Aucune vidéo générée.')
            setResults(prev => [
              ...urls.slice(0, count).map(
                (url): ImagineResult => ({
                  kind: 'video',
                  url,
                  prompt: text,
                  temporary: true
                })
              ),
              ...prev
            ])
            setJob(null)
            return
          }
          await new Promise<void>(resolve => {
            pollTimerRef.current = setTimeout(() => resolve(), 5000)
          })
          return poll()
        }
        await poll()
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Échec de génération.'
      // fetch() TypeError ("Failed to fetch") = connection dropped,
      // typically our serverless function hitting its time limit while
      // the backend was still working — retrying usually succeeds.
      const message =
        err instanceof TypeError || /failed to fetch|networkerror/i.test(raw)
          ? 'Connexion interrompue (serveur trop lent), réessaie.'
          : raw
      setJob({ status: 'error', message })
    } finally {
      busyRef.current = false
      setGenerating(false)
    }
  }

  const handleGenerate = () => {
    void runGeneration({ mode, prompt, aspectRatio, resolution, style })
  }

  const extras: ComposerExtras = {
    variations,
    setVariations,
    variationsLocked,
    attachmentBar: (
      <AttachmentBar
        attachment={attachment}
        onRemove={handleRemoveAttachment}
      />
    ),
    onAttach: () => fileInputRef.current?.click(),
    canSend
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#faf9f7] [font-family:Arial,sans-serif] dark:bg-background">
      <div key={view} className="discover-view flex min-h-full w-full flex-col">
        {view === 'discover' ? (
          <DiscoverView
            onBack={() => setView('create')}
            onRetry={handleGenerate}
            results={results}
            expected={expectedCount}
            working={generating}
            status={job?.status === 'working' ? job.label : null}
            error={job?.status === 'error' ? job.message : null}
            composer={
              <DiscoverComposer
                prompt={prompt}
                setPrompt={setPrompt}
                mode={mode}
                setMode={setMode}
                aspectRatio={aspectRatio}
                cycleAspectRatio={cycleAspectRatio}
                resolution={resolution}
                setResolution={setResolution}
                duration={duration}
                setDuration={setDuration}
                generating={generating}
                onGenerate={handleGenerate}
                extras={extras}
              />
            }
          />
        ) : (
          <div className="mx-auto flex w-full max-w-[752px] flex-col items-center px-4 pt-20 pb-16 md:pt-[100px]">
            <h1 className="imagine-title-shine text-center text-[25px] font-bold leading-[31px] md:text-[26px]">
              Que voulez-vous créer aujourd&apos;hui ?
            </h1>

            {/* Prompt composer */}
            <div className="mt-[34px] w-full overflow-hidden rounded-[22px] border border-[#e3e3e3] bg-white dark:border-border dark:bg-card">
              {extras.attachmentBar}
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
                placeholder="Décrivez ce que vous imaginez"
                rows={1}
                className="min-h-[48px] w-full resize-none bg-transparent px-[19px] pt-[16px] text-[16px] leading-[22px] text-[#111] outline-none placeholder:text-[#707070] dark:text-foreground"
              />

              {/* Bottom toolbar — same composer, controls swap per mode.
              Single scrollable row on mobile (compact, app-like), wrapping
              row on desktop per the reference layout. */}
              <div className="no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto px-[15px] pt-[6px] pb-[11px] md:flex-wrap md:gap-3 md:overflow-visible md:px-[19px]">
                {/* Plus */}
                <ToolbarIconButton
                  label="Ajouter"
                  className="-ml-2"
                  onClick={extras.onAttach}
                >
                  <IconPlus size={20} strokeWidth={2} />
                </ToolbarIconButton>

                {mode === 'image' ? (
                  <>
                    {/* Active Image mode */}
                    <ModeCapsule
                      active
                      label="Image"
                      icon={<IconPhoto size={15} />}
                    />
                    {/* Switch to video mode */}
                    <ToolbarIconButton
                      label="Mode vidéo"
                      onClick={() => setMode('video')}
                    >
                      <IconVideo size={20} />
                    </ToolbarIconButton>
                    {/* Secondary media control */}
                    <ToolbarIconButton label="Médias">
                      <IconLayoutGrid size={19} />
                    </ToolbarIconButton>
                  </>
                ) : (
                  <>
                    {/* Back to image mode (icon only) */}
                    <ToolbarIconButton
                      label="Mode image"
                      onClick={() => setMode('image')}
                    >
                      <IconPhoto size={20} />
                    </ToolbarIconButton>
                    {/* Active Video mode */}
                    <ModeCapsule
                      active
                      wide
                      label="Vidéo"
                      icon={
                        <IconVideo
                          size={16}
                          className="text-black dark:text-foreground"
                        />
                      }
                    />
                    {/* Secondary media control */}
                    <ToolbarIconButton label="Médias">
                      <IconLayoutGrid size={19} />
                    </ToolbarIconButton>
                    {/* Resolution selector — desktop: in toolbar /
                    mobile: below the composer (see below) */}
                    <div className="hidden md:contents">
                      <SegmentedControl
                        options={VIDEO_RESOLUTIONS}
                        value={resolution}
                        onChange={setResolution}
                      />
                    </div>
                    {/* Duration selector (10s coming soon) — desktop: in
                    toolbar / mobile: below the composer (see below) */}
                    <div className="hidden md:contents">
                      <SegmentedControl
                        options={VIDEO_DURATIONS}
                        value={duration}
                        onChange={setDuration}
                        disabledValues={['10s']}
                        disabledHint="Bientôt disponible"
                      />
                    </div>
                    {/* Sound (audio coming soon — stays disabled) */}
                    <ToolbarIconButton label="Audio (bientôt disponible)">
                      <IconVolumeOff size={18} />
                    </ToolbarIconButton>
                  </>
                )}

                {/* Aspect ratio (click cycles 1:1 → 16:9 → 9:16).
                    Hidden in edit/animate mode — the source image decides. */}
                {!extras.variationsLocked && (
                  <button
                    type="button"
                    onClick={cycleAspectRatio}
                    title="Format d'image"
                    className="flex h-[39px] w-[63px] shrink-0 items-center justify-center gap-1.5 rounded-[20px] bg-neutral-100 text-[14px] text-[#111] transition-colors hover:bg-neutral-200/70 dark:bg-muted dark:text-foreground dark:hover:bg-white/10"
                  >
                    <IconRectangleVertical size={14} />
                    {aspectRatio}
                  </button>
                )}
                <VariationsSelect
                  value={extras.variationsLocked ? 1 : extras.variations}
                  onChange={extras.setVariations}
                  locked={extras.variationsLocked}
                />

                {/* Generate, pinned right (stays visible while the
                toolbar row scrolls on mobile) */}
                <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1 bg-white pl-1 dark:bg-card">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    aria-label="Générer"
                    title="Générer"
                    disabled={!extras.canSend}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    {generating ? (
                      <IconLoader2 size={18} className="animate-spin" />
                    ) : (
                      <ArrowUp size={18} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Video settings below the composer — mobile only
            (desktop keeps them inside the toolbar) */}
            {mode === 'video' && (
              <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2 md:hidden">
                <SegmentedControl
                  options={VIDEO_RESOLUTIONS}
                  value={resolution}
                  onChange={setResolution}
                />
                <SegmentedControl
                  options={VIDEO_DURATIONS}
                  value={duration}
                  onChange={setDuration}
                  disabledValues={['10s']}
                  disabledHint="Bientôt disponible"
                />
              </div>
            )}

            {/* Style presets: below the composer on desktop, below the
            resolution/duration selectors on mobile (both sit above this
            block). The backend fills real artwork in later. */}
            <div className="mt-8 w-full">
              <StylePresetGrid
                active={style}
                onSelect={label => setPreview(label)}
                expanded={expanded}
                onToggle={() => setExpanded(prev => !prev)}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleAttachFile(file)
              }}
            />
            {preview && (
              <StylePreviewCard
                label={preview}
                onUse={() => {
                  setStyle(preview)
                  setPreview(null)
                }}
                onSend={() => {
                  setStyle(preview)
                  setPreview(null)
                  void runGeneration({
                    mode,
                    prompt,
                    aspectRatio,
                    resolution,
                    style: preview
                  })
                }}
                onClose={() => setPreview(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
