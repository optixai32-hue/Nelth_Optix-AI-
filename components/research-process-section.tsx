'use client'

import Image from 'next/image'

import type { ReasoningPart } from '@ai-sdk/provider-utils'
import { UseChatHelpers } from '@ai-sdk/react'
import { IconSearch as SearchIcon } from '@tabler/icons-react'
import { PanelRightOpen as PanelRightIcon, Search as LucideSearchIcon } from 'lucide-react'

import type {
  ToolPart,
  UIDataTypes,
  UIMessage,
  UIMessageMetadata,
  UITools
} from '@/lib/types/ai'
import type { DynamicToolPart } from '@/lib/types/dynamic-tools'
import { cn } from '@/lib/utils'

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep
} from '@/components/ai-elements/chain-of-thought'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from '@/components/ai-elements/reasoning'

import { useArtifact } from './artifact/artifact-context'
import { DocumentToolContent } from './artifact/document-tool-content'
import { ImageGeneration } from './elements/image-generation'
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger
} from './prompt-kit/steps'
import { ShimmerSkeleton } from './ui/shimmer-skeleton'
import { SearchResultsImageSection } from './search-results-image'
import { ToolSection } from './tool-section'

// Message part types
type TextPart = {
  type: 'text'
  text: string
}

type MessagePart = ReasoningPart | ToolPart | TextPart | DynamicToolPart

// Type guards
function isReasoningPart(part: MessagePart): part is ReasoningPart {
  return part.type === 'reasoning'
}

function isToolPart(part: MessagePart): part is ToolPart {
  return (
    (part.type?.startsWith?.('tool-') && part.type !== 'dynamic-tool') ?? false
  )
}

function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

function isNonEmptyTextPart(part: MessagePart): part is TextPart {
  return isTextPart(part) && part.text.trim().length > 0
}

function isRenderablePart(part: MessagePart): boolean {
  if (isReasoningPart(part) || isTextPart(part)) {
    return part.text.trim().length > 0
  }
  return true
}

type Props = {
  message: UIMessage
  messageId: string
  getIsOpen: (id: string, partType?: string, hasNextPart?: boolean) => boolean
  onOpenChange: (id: string, open: boolean) => void
  status?: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  addToolResult?: (params: { toolCallId: string; result: any }) => void
  parts?: MessagePart[]
  hasSubsequentText?: boolean
}

export function ResearchProcessSection({
  message,
  messageId,
  getIsOpen,
  onOpenChange,
  status,
  addToolResult,
  parts: partsOverride,
  hasSubsequentText = false
}: Props) {
  const baseParts = (partsOverride ?? (message.parts || [])) as MessagePart[]

  // Nelth-3.5 (tencent/hy3:free, served from the Kilo gateway) runs with thinking
  // OFF (reasoning_effort: "no_think"), but we keep this guard so the final
  // answer is shown cleanly if any reasoning block ever leaks through.
  const modelId = (message.metadata as UIMessageMetadata | undefined)?.modelId
  const hideReasoning =
    typeof modelId === 'string' && modelId.includes('tencent/hy3:free')

  const allParts = hideReasoning
    ? baseParts.filter(p => !isReasoningPart(p))
    : baseParts

  const filteredParts = allParts.filter(isRenderablePart)

  if (filteredParts.length === 0) return null

  // Render parts in their natural order. Consecutive reasoning parts are
  // merged into a single block so the timeline stays step-by-step
  // (thinking, web search, thinking, ...) instead of grouping all
  // reasonings above all tools.
  const items: Array<{ kind: 'reasoning'; parts: ReasoningPart[] } | { kind: 'tool'; part: MessagePart }> = []
  let currentReasoning: ReasoningPart[] = []

  const flushReasoning = () => {
    if (currentReasoning.length > 0) {
      items.push({ kind: 'reasoning', parts: currentReasoning })
      currentReasoning = []
    }
  }

  filteredParts.forEach(part => {
    if (isReasoningPart(part)) {
      currentReasoning.push(part)
    } else {
      // Any non-reasoning part (tool, text, unknown) splits the reasoning
      // stream so consecutive reasonings are kept in their true positions.
      flushReasoning()
      if (isToolPart(part)) {
        items.push({ kind: 'tool', part })
      }
    }
  })
  flushReasoning()

  const isGlobalStreaming = status === 'submitted' || status === 'streaming'

  // A reasoning block is "still streaming" only while it is the live, in-progress
  // one. The robust signal is its POSITION in the part list: once the model emits
  // a tool call or answer text AFTER a reasoning block, that reasoning is finished
  // and must not be treated as live (no shimmer replay, and it can auto-close).
  // We deliberately do NOT rely on the part's `state` field: in this AI SDK
  // version reasoning parts report `state: "done"` even while still streaming,
  // which would wrongly mark the block as finished — breaking the auto-close and
  // leaving `duration` undefined ("Thought for a few seconds").
  let lastStreamingReasoningKey: string | null = null
  if (isGlobalStreaming) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind !== 'reasoning') continue
      const lastPart = item.parts[item.parts.length - 1]
      const pos = filteredParts.indexOf(lastPart)
      const hasFollowingContent =
        pos >= 0 &&
        filteredParts.slice(pos + 1).some(p => isToolPart(p) || isNonEmptyTextPart(p))
      if (!hasFollowingContent) {
        lastStreamingReasoningKey = `${messageId}-reasoning-${i}`
        break
      }
    }
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => {
        if (item.kind === 'tool') {
          const part = item.part as ToolPart
          return (
            <ToolStep
              key={`${messageId}-tool-${idx}`}
              part={part}
              isOpen={getIsOpen(part.toolCallId, part.type, false)}
              onOpenChange={open => onOpenChange(part.toolCallId, open)}
              status={status}
              addToolResult={addToolResult}
              isStreaming={isGlobalStreaming}
            />
          )
        }

        const reasoningKey = `${messageId}-reasoning-${idx}`
        const mergedParts = item.parts
        const hasSubsequentText = filteredParts.some(
          (p, i) =>
            i > filteredParts.indexOf(mergedParts[mergedParts.length - 1]) &&
            isNonEmptyTextPart(p)
        )
        return (
          <ReasoningStep
            key={reasoningKey}
            parts={mergedParts}
            isOpen={getIsOpen(reasoningKey, 'reasoning', hasSubsequentText)}
            onOpenChange={open => onOpenChange(reasoningKey, open)}
            isStreaming={isGlobalStreaming}
            isActive={lastStreamingReasoningKey === reasoningKey}
          />
        )
      })}
    </div>
  )
}

function ReasoningStep({
  parts,
  isOpen,
  onOpenChange,
  isStreaming,
  isActive = false
}: {
  parts: ReasoningPart[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isStreaming: boolean
  isActive?: boolean
}) {
  const text = parts.map(p => p.text || '').join('\n\n')
  const { open: openArtifact } = useArtifact()

  if (!text.trim() && !isStreaming) return null

  const handleOpenPanel = () => {
    if (parts.length > 0) {
      openArtifact({ ...parts[0], text })
    }
  }

  return (
    <div data-testid="reasoning-section" className="group/reasoning flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Reasoning
          isStreaming={isStreaming && isActive}
          defaultOpen={isOpen}
          onOpenChange={onOpenChange}
          className="not-prose mb-0"
        >
          <ReasoningTrigger />
          <ReasoningContent>{text}</ReasoningContent>
        </Reasoning>
      </div>
      <button
        type="button"
        onClick={handleOpenPanel}
        title="Open reasoning panel"
        aria-label="Open reasoning panel"
        className="mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/reasoning:opacity-100"
      >
        <PanelRightIcon className="size-4" />
      </button>
    </div>
  )
}

function ToolStep({
  part,
  isOpen,
  onOpenChange,
  status,
  addToolResult,
  isStreaming
}: {
  part: ToolPart
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  status?: any
  addToolResult?: (params: { toolCallId: string; result: any }) => void
  isStreaming: boolean
}) {
  const isSearch = part.type === 'tool-search'
  const isFetch = part.type === 'tool-fetch'
  const isImageGen = part.type === 'tool-generateImage'
  const query =
    (part.input as any)?.query || (part.input as any)?.url || part.type

  // Image generation: render the prompt + generated image (or a loader).
  if (isImageGen) {
    const output =
      part.state === 'output-available' ? (part.output as any) : undefined
    const generating = !output || output.state === 'generating'
    const errorText =
      output?.state === 'error' ? output?.errorText : undefined
    const prompt =
      output?.revisedPrompt || output?.originalPrompt ||
      (part.input as any)?.prompt || ''

    return (
      <ImageGeneration
        prompt={prompt}
        generating={generating && !errorText}
        imageUrl={output?.imageUrl}
        errorText={errorText}
      />
    )
  }

  // Document: render a simple shimmering line ("Generating your PDF…") while
  // the file is produced, then a download link once it is ready.
  if (part.type === 'tool-document') {
    return <DocumentToolContent part={part as ToolPart<'document'>} />
  }

  // Web search: render with the ChainOfThought component, listing result
  // sources as badges (collapsible to the full SearchSection details).
  if (isSearch) {
    const output =
      part.state === 'output-available' ? (part.output as any) : undefined
    const images = Array.isArray(output?.images) ? output.images : []
    const sources: string[] = [
      ...(output?.results ?? []).map((r: any) => r.url).filter(Boolean),
      ...(output?.videos ?? []).map((v: any) => v.url).filter(Boolean)
    ]
    const hostnames = Array.from(
      new Set(
        sources
          .map(url => {
            try {
              return new URL(url).hostname.replace(/^www\./, '')
            } catch {
              return null
            }
          })
          .filter(Boolean) as string[]
      )
    )

    return (
      <div className="space-y-3">
        <ChainOfThought
          data-testid="tool-section"
          defaultOpen={isOpen}
          onOpenChange={onOpenChange}
          className="not-prose"
        >
          <ChainOfThoughtHeader>
            {`Web search: ${query}`}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep
              icon={LucideSearchIcon}
              label={`Searching for "${query}"`}
              status={output ? 'complete' : 'active'}
            >
              {hostnames.length > 0 && (
                <ChainOfThoughtSearchResults>
                  {hostnames.map(host => (
                    <ChainOfThoughtSearchResult key={host}>
                      {host}
                    </ChainOfThoughtSearchResult>
                  ))}
                </ChainOfThoughtSearchResults>
              )}
            </ChainOfThoughtStep>
          </ChainOfThoughtContent>
        </ChainOfThought>
        {/* No gallery grid for image searches (20 candidates): images are
            shown directly in the answer instead. */}
        {images.length > 0 && images.length <= 3 && (
          <div className="my-2 not-prose">
            <SearchResultsImageSection images={images} query={query} />
          </div>
        )}
      </div>
    )
  }

  // Fetch: render with the ChainOfThought component (no card border),
  // matching the web-search look and avoiding the boxed "table" style.
  if (isFetch) {
    const isFetching =
      part.state === 'input-streaming' ||
      part.state === 'input-available' ||
      (part.state === 'output-available' &&
        (part.output as any)?.state === 'fetching')

    const fetchOutput = part.state === 'output-available' ? (part.output as any) : undefined
    const fetchItem =
      fetchOutput?.results?.[0] ??
      (fetchOutput?.result ? fetchOutput : undefined)
    const fetchUrl = fetchItem?.url || (part.input as any)?.url || query
    const fetchTitle = fetchItem?.title || fetchUrl
    const fetchContent: string | undefined = fetchItem?.content
    const fetchChars = fetchContent?.length
    const fetchDomain = (() => {
      try {
        return new URL(fetchUrl).hostname.replace(/^www\./, '')
      } catch {
        return fetchUrl
      }
    })()

    return (
      <ChainOfThought
        data-testid="tool-section"
        defaultOpen={isOpen}
        onOpenChange={onOpenChange}
        className="not-prose"
      >
        <ChainOfThoughtHeader>{`Fetch: ${fetchDomain}`}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            icon={LucideSearchIcon}
            label={
              isFetching
                ? `Fetching ${fetchDomain}`
                : `Fetched ${fetchDomain}`
            }
            status={part.state === 'output-available' ? 'complete' : 'active'}
          >
            {isFetching ? (
              <div className="space-y-2 pt-1">
                <ShimmerSkeleton className="h-3 w-full" />
                <ShimmerSkeleton className="h-3 w-5/6" />
                <ShimmerSkeleton className="h-3 w-2/3" />
              </div>
            ) : fetchItem ? (
              <div className="space-y-2 pt-1">
                <a
                  href={fetchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:underline"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
                    <Image
                      src={`https://www.google.com/s2/favicons?domain=${fetchDomain}&sz=16`}
                      alt={fetchDomain}
                      width={16}
                      height={16}
                      className="bg-background"
                      unoptimized
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {fetchTitle}
                  </span>
                </a>
                {fetchChars ? (
                  <p className="text-muted-foreground text-xs">
                    {fetchChars > 1000
                      ? `${Math.round(fetchChars / 1000)}k chars`
                      : `${fetchChars} chars`}
                    {fetchContent ? ' extracted' : ''}
                  </p>
                ) : null}
                {fetchContent ? (
                  <p className="line-clamp-4 text-sm text-foreground/80">
                    {fetchContent}
                  </p>
                ) : null}
              </div>
            ) : (
              <ToolSection
                tool={part}
                isOpen={isOpen}
                onOpenChange={onOpenChange}
                status={status}
                addToolResult={addToolResult}
              />
            )}
          </ChainOfThoughtStep>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
  }

  const triggerLabel = part.type.replace('tool-', '')

  return (
    <Steps>
      <StepsTrigger leftIcon={<SearchIcon className="size-4" />}>
        {triggerLabel}
      </StepsTrigger>
      <StepsContent>
        {isStreaming && part.state !== 'output-available' ? (
          <StepsItem>Running…</StepsItem>
        ) : (
          <div className="pb-1">
            <ToolSection
              tool={part}
              isOpen={isOpen}
              onOpenChange={onOpenChange}
              status={status}
              addToolResult={addToolResult}
            />
          </div>
        )}
      </StepsContent>
    </Steps>
  )
}

export default ResearchProcessSection
