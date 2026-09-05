'use client'

import { UseChatHelpers } from '@ai-sdk/react'
import {
  IconAlertCircle as AlertCircle,
  IconBrandGithub as GithubIcon,
  IconCalendar as CalendarIcon,
  IconCheck as Check,
  IconFolder as FolderIcon,
  IconMail as MailIcon,
  IconNotebook as NotionIcon
} from '@tabler/icons-react'

import type { ToolPart, UIDataTypes, UIMessage, UITools } from '@/lib/types/ai'
import { cn } from '@/lib/utils'

import { ShimmerSkeleton } from '@/components/ui/shimmer-skeleton'

import { TextShimmer } from '@/components/prompt-kit/text-shimmer'

import ProcessHeader from './process-header'

interface ConnectorSectionProps {
  tool: ToolPart
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  status?: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  borderless?: boolean
  isFirst?: boolean
  isLast?: boolean
}

const SERVICE_META: Record<
  string,
  { label: string; connecting: string; Icon: typeof MailIcon }
> = {
  'tool-gmail': {
    label: 'Gmail',
    connecting: 'Connexion à Gmail…',
    Icon: MailIcon
  },
  'tool-drive': {
    label: 'Drive',
    connecting: 'Lecture de Drive…',
    Icon: FolderIcon
  },
  'tool-calendar': {
    label: 'Agenda',
    connecting: 'Consultation de l’agenda…',
    Icon: CalendarIcon
  },
  'tool-github': {
    label: 'GitHub',
    connecting: 'Recherche dans GitHub…',
    Icon: GithubIcon
  },
  'tool-notion': {
    label: 'Notion',
    connecting: 'Lecture de Notion…',
    Icon: NotionIcon
  }
}

function describeInput(tool: ToolPart): string {
  const input = (tool.input ?? {}) as Record<string, unknown>
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const direct = str(input.query) ?? str(input.messageId) ?? str(input.fileId)
  if (direct) return direct
  const repoPath = [str(input.owner), str(input.repo), str(input.path)]
    .filter(Boolean)
    .join('/')
  if (repoPath) return repoPath
  return (
    str(input.pageId) ??
    (typeof input.action === 'string' ? input.action : 'lecture')
  )
}

function itemTitle(item: Record<string, unknown>): string {
  for (const key of ['subject', 'name', 'summary', 'title']) {
    const v = item[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return 'Élément'
}

export function ConnectorSection({
  tool,
  isOpen, // Required by ToolSection interface
  onOpenChange, // Required by ToolSection interface
  status,
  borderless = false,
  isFirst = false,
  isLast = false
}: ConnectorSectionProps) {
  const meta = SERVICE_META[tool.type] ?? {
    label: tool.type.replace('tool-', ''),
    connecting: 'Connexion…',
    Icon: FolderIcon
  }
  const { Icon } = meta
  const isLoading = status === 'submitted' || status === 'streaming'
  const isToolLoading =
    tool.state === 'input-streaming' || tool.state === 'input-available'

  const output =
    tool.state === 'output-available' ? (tool.output as any) : undefined
  const isConnecting = !output || output?.state === 'connecting'
  const isComplete = output?.state === 'complete'
  const isAuthRequired = output?.state === 'auth-required'
  const isOutputError =
    tool.state === 'output-error' || output?.state === 'error'

  const items: Record<string, unknown>[] = Array.isArray(output?.items)
    ? output.items
    : []
  const contentLength =
    typeof output?.content === 'string' ? output.content.length : undefined
  const entriesCount = Array.isArray(output?.entries)
    ? output.entries.length
    : undefined

  let resultCount: number | undefined
  if (items.length > 0) resultCount = items.length
  else if (typeof entriesCount === 'number') resultCount = entriesCount
  else if (isComplete && contentLength !== undefined) resultCount = 1

  const errorText = isAuthRequired
    ? 'Reconnexion requise'
    : typeof output?.message === 'string'
      ? output.message
      : tool.state === 'output-error'
        ? (tool.errorText ?? 'Échec de la lecture')
        : undefined

  const header = (
    <ProcessHeader
      isLoading={isLoading && (isToolLoading || isConnecting)}
      label={
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="block min-w-0 max-w-full truncate">
            {meta.label} : {describeInput(tool)}
          </span>
        </div>
      }
      meta={
        isComplete && resultCount !== undefined ? (
          <>
            <Check size={16} className="text-green-500" />
            <span>
              {resultCount} résultat{resultCount > 1 ? 's' : ''}
            </span>
          </>
        ) : isOutputError || isAuthRequired ? (
          <>
            <AlertCircle size={16} className="text-destructive" />
            <span>{errorText}</span>
          </>
        ) : isToolLoading || isConnecting ? (
          <TextShimmer className="text-xs text-muted-foreground">
            {meta.connecting}
          </TextShimmer>
        ) : undefined
      }
      className={cn(isComplete && 'cursor-default')}
    />
  )

  return (
    <div className="relative">
      {borderless && (
        <>
          {!isFirst && (
            <div className="absolute top-0 left-[19.5px] h-2 w-px bg-border" />
          )}
          {!isLast && (
            <div className="absolute bottom-0 left-[19.5px] h-2 w-px bg-border" />
          )}
        </>
      )}
      <div className="py-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{header}</div>
        </div>
        {(isLoading && (isToolLoading || isConnecting)) ||
        (!output && isLoading) ? (
          <div className="space-y-2 pt-2">
            <ShimmerSkeleton className="h-3 w-full" />
            <ShimmerSkeleton className="h-3 w-5/6" />
            <ShimmerSkeleton className="h-3 w-2/3" />
          </div>
        ) : null}
        {isComplete && items.length > 0 ? (
          <ul className="space-y-1 pt-2">
            {items.slice(0, 3).map((item, i) => (
              <li key={i} className="truncate text-sm text-foreground/80">
                {itemTitle(item)}
              </li>
            ))}
          </ul>
        ) : null}
        {isComplete && items.length === 0 && contentLength !== undefined ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {contentLength > 1000
              ? `${Math.round(contentLength / 1000)}k caractères lus`
              : `${contentLength} caractères lus`}
          </p>
        ) : null}
        {isAuthRequired ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Reconnecte {meta.label} depuis la carte « Connecter une application
            », puis repose ta question.
          </p>
        ) : null}
        {isOutputError && !isAuthRequired && errorText ? (
          <p className="pt-1 text-xs text-muted-foreground">{errorText}</p>
        ) : null}
      </div>
    </div>
  )
}

export default ConnectorSection
