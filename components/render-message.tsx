import { UseChatHelpers } from '@ai-sdk/react'

import type { SearchResultItem } from '@/lib/types'
import type {
  UIDataTypes,
  UIMessage,
  UIMessageMetadata,
  UITools
} from '@/lib/types/ai'
import type { DynamicToolPart } from '@/lib/types/dynamic-tools'
import { splitThinking } from '@/lib/utils/strip-thinking'

import { AnswerSection } from './answer-section'
import { DynamicToolDisplay } from './dynamic-tool-display'
import ResearchProcessSection from './research-process-section'
import { UploadedFileList } from './uploaded-file-list'
import { UserTextSection } from './user-text-section'
interface RenderMessageProps {
  message: UIMessage
  messageId: string
  getIsOpen: (id: string, partType?: string, hasNextPart?: boolean) => boolean
  onOpenChange: (id: string, open: boolean) => void
  chatId?: string
  isGuest?: boolean
  isCloudDeployment?: boolean
  libraryAvailable?: boolean
  status?: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  addToolResult?: (params: { toolCallId: string; result: any }) => void
  onUpdateMessage?: (messageId: string, newContent: string) => Promise<void>
  reload?: (messageId: string) => Promise<void | string | null | undefined>
  isLatestMessage?: boolean
  citationMaps?: Record<string, Record<number, SearchResultItem>>
  onQuoteContext?: (text: string) => void
  searchResults?: SearchResultItem[]
  searchTool?: any
  /** When true, the user's file attachments are rendered by the parent
   *  (outside the message bubble) instead of inside it. */
  hideUserFileList?: boolean
}

export function RenderMessage({
  message,
  messageId,
  getIsOpen,
  onOpenChange,
  chatId,
  isGuest = false,
  isCloudDeployment = false,
  libraryAvailable = true,
  status,
  addToolResult,
  onUpdateMessage,
  reload,
  isLatestMessage = false,
  citationMaps = {},
  onQuoteContext,
  searchResults,
  searchTool,
  hideUserFileList = false
}: RenderMessageProps) {
  const isNonEmptyTextPart = (part: any) =>
    part?.type === 'text' &&
    typeof part.text === 'string' &&
    part.text.trim().length > 0

  /** Extract the user's uploaded file attachments from the message parts. */
  const extractUserFileAttachments = (parts: any[]) =>
    (parts ?? [])
      .filter((part: any) => part.type === 'file')
      .map((part: any) => ({
        url: part.url,
        name: part.filename || 'Unknown file',
        mediaType: part.mediaType || 'application/octet-stream',
        status: 'uploaded' as const
      }))

  // Use provided citation maps (from all messages)
  if (message.role === 'user') {
    const parts = (message.parts ?? []) as any[]
    const textPart = parts.find((part: any) => part.type === 'text')
    const pastedTexts = parts
      .filter((part: any) => part.type === 'data-pastedContent')
      .map((part: any) => part.data?.text ?? '')
    const quotedContexts = parts
      .filter((part: any) => part.type === 'data-quotedContext')
      .map((part: any) => part.data?.text ?? '')
    const noteContexts = parts
      .filter((part: any) => part.type === 'data-noteContext')
      .map((part: any) => ({
        title: part.data?.title,
        text: part.data?.text ?? ''
      }))
    const urls = parts
      .filter((part: any) => part.type === 'data-sourceUrl')
      .map((part: any) => part.data?.url ?? '')
    const fileAttachments = extractUserFileAttachments(parts)
    return (
      <>
        {!hideUserFileList && fileAttachments.length > 0 && (
          <UploadedFileList
            files={fileAttachments}
            onRemove={() => {}}
            readOnly
          />
        )}
        {(textPart ||
          pastedTexts.length > 0 ||
          quotedContexts.length > 0 ||
          noteContexts.length > 0 ||
          urls.length > 0) && (
          <UserTextSection
            content={textPart?.text ?? ''}
            pastedTexts={pastedTexts}
            quotedContexts={quotedContexts}
            noteContexts={noteContexts}
            urls={urls}
            messageId={messageId}
            onUpdateMessage={onUpdateMessage}
          />
        )}
      </>
    )
  }

  // New rendering: interleave text parts with grouped non-text segments
  const elements: React.ReactNode[] = []
  let buffer: any[] = []

  // Collect search result sources from this assistant message's tool-search
  // parts, so the answer footer can show favicons + a total result count.
  const messageSearchResults: SearchResultItem[] =
    searchResults ??
    (message.parts ?? [])
      .filter(
        (p: any) => p.type === 'tool-search' && p.state === 'output-available'
      )
      .flatMap((p: any) => {
        const output = p.output ?? {}
        return [
          ...(output.results ?? []),
          ...(output.videos ?? []).map((v: any) => ({
            title: v.title,
            url: v.link ?? v.url,
            content: v.snippet ?? ''
          })),
          ...(output.images ?? []).map((img: any) => ({
            title: typeof img === 'string' ? '' : (img.title ?? ''),
            url:
              typeof img === 'string' ? img : (img.sourceUrl ?? img.url ?? ''),
            content: typeof img === 'string' ? '' : (img.description ?? '')
          }))
        ].filter((r: any) => r && r.url) as SearchResultItem[]
      })

  const messageSearchTool: any =
    searchTool ??
    (message.parts ?? []).find(
      (p: any) => p.type === 'tool-search' && p.state === 'output-available'
    )
  const flushBuffer = (keySuffix: string) => {
    if (buffer.length === 0) return
    elements.push(
      <ResearchProcessSection
        key={`${messageId}-proc-${keySuffix}`}
        message={message}
        messageId={messageId}
        parts={buffer}
        getIsOpen={getIsOpen}
        onOpenChange={onOpenChange}
        status={status}
        addToolResult={addToolResult}
      />
    )
    buffer = []
  }

  message.parts?.forEach((part: any, index: number) => {
    if (part.type === 'text') {
      // Ignore empty text chunks (some providers emit them before reasoning/tool parts).
      if (!isNonEmptyTextPart(part)) {
        return
      }

      // Check if there's buffered content before this text part
      const hasBufferedContent = buffer.length > 0

      // Flush accumulated non-text first, marking that text follows
      if (hasBufferedContent) {
        // Create a custom flush that passes hasSubsequentText
        if (buffer.length > 0) {
          elements.push(
            <ResearchProcessSection
              key={`${messageId}-proc-seg-${index}`}
              message={message}
              messageId={messageId}
              parts={buffer}
              getIsOpen={getIsOpen}
              onOpenChange={onOpenChange}
              status={status}
              addToolResult={addToolResult}
              hasSubsequentText={true}
            />
          )
          buffer = []
        }
      }

      const remainingParts = message.parts?.slice(index + 1) || []
      const hasMoreTextParts = remainingParts.some(isNonEmptyTextPart)
      const isLastTextPart = !hasMoreTextParts
      const isStreamingComplete =
        status !== 'streaming' && status !== 'submitted'
      const shouldShowActions =
        isLastTextPart && (isLatestMessage ? isStreamingComplete : true)

      // Some providers (e.g. NVIDIA Nemotron) emit their reasoning inside
      // <think>...</think> blocks within the text stream. Pull that reasoning
      // out so it is rendered as a collapsible block and kept out of the
      // final answer.
      const { reasoning, answer } = splitThinking(part.text)
      if (reasoning) {
        buffer.push({ type: 'reasoning', text: reasoning } as any)
      }

      elements.push(
        <AnswerSection
          key={`${messageId}-text-${index}`}
          content={answer}
          isOpen={getIsOpen(
            messageId,
            part.type,
            index < (message.parts?.length ?? 0) - 1
          )}
          onOpenChange={open => onOpenChange(messageId, open)}
          chatId={chatId}
          isGuest={isGuest}
          isCloudDeployment={isCloudDeployment}
          libraryAvailable={libraryAvailable}
          showActions={shouldShowActions}
          messageId={messageId}
          metadata={message.metadata as UIMessageMetadata | undefined}
          reload={reload}
          status={status}
          citationMaps={citationMaps}
          onQuoteContext={onQuoteContext}
          searchResults={messageSearchResults}
          searchTool={messageSearchTool}
        />
      )
    } else if (part.type === 'reasoning' || part.type?.startsWith?.('tool-')) {
      buffer.push(part)
    } else if (part.type === 'dynamic-tool') {
      flushBuffer(`seg-${index}`)
      elements.push(
        <DynamicToolDisplay
          key={`${messageId}-dynamic-tool-${index}`}
          part={part as DynamicToolPart}
        />
      )
    }
  })
  // Flush tail (no subsequent text)
  flushBuffer('tail')

  return <>{elements}</>
}
