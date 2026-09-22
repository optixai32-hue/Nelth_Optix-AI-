'use client'

import { useState } from 'react'

import {
  IconLayoutGrid,
  IconPhoto,
  IconPlus,
  IconRectangleVertical,
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
        const isDisabled =
          disabledValues.includes(option) && !isActive
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
    <div className="grid grid-cols-4 gap-[6px] md:grid-cols-5 lg:grid-cols-6">
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
              src={`https://picsum.photos/seed/${encodeURIComponent(label)}/120/176`}
              alt={label}
              loading="lazy"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/65 via-black/20 to-transparent"
            />
            <span className="absolute bottom-[6px] left-[6px] right-[6px] text-left text-[10px] font-semibold leading-tight text-white">
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
          <X size={17} strokeWidth={2} />
        ) : (
          <IconPlus size={17} strokeWidth={2} />
        )}
        <span className="text-[10px] font-medium">
          {expanded ? 'Fermer' : 'Plus'}
        </span>
      </button>
    </div>
  )
}

export function ImagineStudio({ onGenerate }: ImagineStudioProps) {
  const [mode, setMode] = useState<StudioMode>('image')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] =
    useState<VideoResolution>('480p')
  const [duration, setDuration] = useState<VideoDuration>('6s')
  const [style, setStyle] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const cycleAspectRatio = () => {
    setAspectRatio(
      prev => ASPECT_RATIOS[(ASPECT_RATIOS.indexOf(prev) + 1) % ASPECT_RATIOS.length]
    )
  }

  const handleGenerate = () => {
    onGenerate?.({
      mode,
      prompt: prompt.trim(),
      aspectRatio,
      resolution,
      duration,
      style
    })
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#faf9f7] [font-family:Arial,sans-serif] dark:bg-background">
      <div className="mx-auto flex w-full max-w-[752px] flex-col items-center px-4 pt-20 pb-16 md:pt-[100px]">
        <h1 className="text-center text-[25px] font-bold leading-[31px] text-[#080808] md:text-[26px] dark:text-foreground">
          Qu&apos;allons-nous imaginer ?
        </h1>

        {/* Prompt composer */}
        <div className="mt-[34px] w-full overflow-hidden rounded-[22px] border border-[#e3e3e3] bg-white dark:border-border dark:bg-card">
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
                  icon={<IconVideo size={16} className="text-black dark:text-foreground" />}
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
                <ToolbarIconButton
                  label="Audio (bientôt disponible)"
                >
                  <IconVolumeOff size={18} />
                </ToolbarIconButton>
              </>
            )}

            {/* Aspect ratio (click cycles 1:1 → 16:9 → 9:16) */}
            <button
              type="button"
              onClick={cycleAspectRatio}
              title="Format d'image"
              className="flex h-[39px] w-[63px] shrink-0 items-center justify-center gap-1.5 rounded-[20px] bg-neutral-100 text-[14px] text-[#111] transition-colors hover:bg-neutral-200/70 dark:bg-muted dark:text-foreground dark:hover:bg-white/10"
            >
              <IconRectangleVertical size={14} />
              {aspectRatio}
            </button>

            {/* Generate, pinned right (stays visible while the
                toolbar row scrolls on mobile) */}
            <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1 bg-white pl-1 dark:bg-card">
              <button
                type="button"
                onClick={handleGenerate}
                aria-label="Générer"
                title="Générer"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95 dark:bg-white dark:text-black"
              >
                <ArrowUp size={18} strokeWidth={2.5} />
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
            onSelect={label =>
              setStyle(prev => (prev === label ? null : label))
            }
            expanded={expanded}
            onToggle={() => setExpanded(prev => !prev)}
          />
        </div>
      </div>
    </div>
  )
}
