'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { UseChatHelpers } from '@ai-sdk/react'

import { useMediaQuery } from '@/lib/hooks/use-media-query'
import type { UIDataTypes, UIMessage, UITools } from '@/lib/types/ai'
import { cn } from '@/lib/utils'
import { extractCitationMapsFromMessages } from '@/lib/utils/citation'

import { AnimatedLogo } from './ui/animated-logo'
import { ChatError } from './chat-error'
import { ChatFooterMessage } from './chat-footer-message'
import { useI18n } from './i18n-provider'
import { NelthLoadingLabel } from './nelth-loading-label'
import { RenderMessage } from './render-message'
import { UploadedFileList } from './uploaded-file-list'

// Import section structure interface
interface ChatSection {
  id: string
  userMessage: UIMessage
  assistantMessages: UIMessage[]
}

interface ChatMessagesProps {
  sections: ChatSection[] // Changed from messages to sections
  status: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  chatId?: string
  isGuest?: boolean
  isCloudDeployment?: boolean
  libraryAvailable?: boolean
  addToolResult?: (params: { toolCallId: string; result: any }) => void
  /** Ref for the scroll container */
  scrollContainerRef: React.RefObject<HTMLDivElement>
  onUpdateMessage?: (messageId: string, newContent: string) => Promise<void>
  reload?: (messageId: string) => Promise<void | string | null | undefined>
  error?: Error | string | null | undefined
  onQuoteContext?: (text: string) => void
  /** The model selection cookie value (e.g. "tencent:tencent/hy3:free").
   *  Kept for API compatibility; the loading label now shows for all models. */
  selectedModelKey?: string
}

const DESKTOP_LATEST_SECTION_OFFSET = 196
const MOBILE_LATEST_SECTION_OFFSET_FALLBACK = 180
const MOBILE_FOLLOW_UP_TOP_CLEARANCE_FALLBACK = 56

export function ChatMessages({
  sections,
  status,
  chatId,
  isGuest = false,
  isCloudDeployment = false,
  libraryAvailable = true,
  addToolResult,
  scrollContainerRef,
  onUpdateMessage,
  reload,
  error,
  onQuoteContext
}: ChatMessagesProps) {
  // Track user-modified states (when user explicitly opens/closes)
  const [userModifiedStates, setUserModifiedStates] = useState<
    Record<string, boolean>
  >({})
  // Cache tool counts for performance optimization
  const toolCountCacheRef = useRef<Map<string, number>>(new Map())
  const isLoading = status === 'submitted' || status === 'streaming'
  const isMobile = useMediaQuery('(max-width: 767px)')
  const { t } = useI18n()

  // Shimmer loading label for ALL models while waiting for the first real
  // text token in the UI. The label is intentionally DELAYED 500ms:
  //   - Simple questions (bonjour, math)  → response in <300ms  → label never appears
  //   - Tool-heavy requests (web search, connectors, skills) → label shows at
  //     500ms with the CURRENT activity ("Connexion à Gmail…"), then falls
  //     back to rotating generic phases between tool calls.
  //   - Label hides ONLY when actual text appears in the message (not on status change)
  //     so it doesn't vanish before the user sees any content.

  // True once the latest assistant message contains at least one non-empty text part.
  // Recomputed only when sections change (not on every render tick).
  const hasFirstToken = useMemo(() => {
    const latestSection = sections[sections.length - 1]
    const latestMsg = latestSection?.assistantMessages[latestSection.assistantMessages.length - 1]
    return Boolean(
      latestMsg?.parts?.some(
        (p: any) => p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0
      )
    )
  }, [sections])

  // True for greetings, emoji-only, and short messages (≤2 words).
  // The shimmer label should NEVER appear for these — even if Nelth-3.5 takes
  // 600ms on a slow day, showing "Lecture des compétences..." for "bonjour"
  // would confuse the user.
  const isTrivialQuery = useMemo(() => {
    const latestSection = sections[sections.length - 1]
    const query =
      (latestSection?.userMessage.parts as any[] | undefined)
        ?.find((p: any) => p.type === 'text')
        ?.text?.trim() ?? ''
    if (!query) return true
    const wordCount = query.split(/\s+/).filter(Boolean).length
    if (wordCount <= 2) return true
    return /^(bonjour|salut|hi|hello|hey|bonsoir|coucou|merci|thanks?|ok|oui|non|yes|no|hola|allo|allô|good morning|bonne nuit|good night)[\s!?,.]*/i.test(
      query
    )
  }, [sections])

  // Current tool activity for the shimmer label ("Connexion à Gmail…").
  // Scans the latest assistant message from the end: the most recent tool
  // part wins while it is still running (input streaming OR an in-progress
  // output beat like searching/fetching/connecting). A completed tool
  // returns null so the label falls back to the generic rotating phases
  // until the first text token arrives.
  //
  // Intentionally NOT memoized: the strings depend on `t` (locale) and the
  // scan is a handful of parts — cheaper than fighting the React Compiler
  // over manual memoization with unstable deps.
  const currentActivity = (() => {
    const activityFor: Record<string, string> = {
      'tool-gmail': t('connector.activity.gmail'),
      'tool-drive': t('connector.activity.drive'),
      'tool-calendar': t('connector.activity.calendar'),
      'tool-github': t('connector.activity.github'),
      'tool-notion': t('connector.activity.notion')
    }
    const latestSection = sections[sections.length - 1]
    const parts = (latestSection?.assistantMessages[
      latestSection.assistantMessages.length - 1
    ]?.parts ?? []) as any[]
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (typeof p?.type !== 'string' || !p.type.startsWith('tool-')) continue
      if (p.state === 'output-available') {
        const beat = p.output?.state
        if (beat === 'searching') {
          const q =
            typeof p.output?.query === 'string'
              ? p.output.query.trim().slice(0, 60)
              : ''
          return q
            ? `${t('connector.activity.searching')} : ${q}…`
            : `${t('connector.activity.searching')}…`
        }
        if (beat === 'fetching') return t('connector.activity.readingPage')
        if (beat === 'connecting')
          return activityFor[p.type] ?? t('connector.activity.searching')
        if (beat === 'generating')
          return t('connector.activity.generatingImage')
        return null
      }
      if (p.type === 'tool-search')
        return `${t('connector.activity.searching')}…`
      if (p.type === 'tool-fetch') return t('connector.activity.readingPage')
      if (activityFor[p.type]) return activityFor[p.type]
      if (p.type === 'tool-document')
        return t('connector.activity.generatingDoc')
      if (p.type === 'tool-generateImage')
        return t('connector.activity.generatingImage')
      return null
    }
    return null
  })()

  // Delayed visibility for the shimmer label: the 500ms timer fires inside a
  // callback (no synchronous setState in the effect body). Hiding is derived
  // (`shouldShow && labelFired`) so no state write is needed when the first
  // token arrives or the stream ends.
  const [labelFired, setLabelFired] = useState(false)
  const nelthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guard: prevents the 500ms timer from restarting on every re-render while
  // we are still in the "should show" window (e.g. while sections stream in
  // but no text yet).
  const labelScheduledRef = useRef(false)

  const shouldShowNelthLabel = isLoading && !hasFirstToken && !isTrivialQuery

  useEffect(() => {
    if (!shouldShowNelthLabel) return
    if (labelScheduledRef.current) return
    // First time entering the waiting window — arm the 500ms timer once.
    labelScheduledRef.current = true
    nelthTimerRef.current = setTimeout(() => setLabelFired(true), 500)

    return () => {
      labelScheduledRef.current = false
      if (nelthTimerRef.current) {
        clearTimeout(nelthTimerRef.current)
        nelthTimerRef.current = null
      }
    }
  }, [shouldShowNelthLabel])

  const showNelthLabel = shouldShowNelthLabel && labelFired

  const [scrollViewportHeight, setScrollViewportHeight] = useState(0)
  const [mobileFollowUpTopClearance, setMobileFollowUpTopClearance] = useState(
    MOBILE_FOLLOW_UP_TOP_CLEARANCE_FALLBACK
  )

  // Tool types definition - moved outside function for performance
  const toolTypes = [
    'tool-search',
    'tool-fetch',
    'tool-askQuestion',
    'tool-gmail',
    'tool-drive',
    'tool-calendar',
    'tool-github',
    'tool-notion'
  ]

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateMetrics = () => {
      const { paddingTop } = getComputedStyle(container)
      setScrollViewportHeight(container.clientHeight)
      setMobileFollowUpTopClearance(
        parseFloat(paddingTop) || MOBILE_FOLLOW_UP_TOP_CLEARANCE_FALLBACK
      )
    }
    updateMetrics()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateMetrics)
    observer.observe(container)

    return () => observer.disconnect()
  }, [scrollContainerRef])

  // Clear cache during streaming to ensure accurate tool counts
  useEffect(() => {
    if (isLoading) {
      // Clear cache for all messages during streaming
      toolCountCacheRef.current.clear()
    }
  }, [isLoading])

  const latestSectionMinHeight =
    isMobile && scrollViewportHeight > 0
      ? `${Math.max(0, scrollViewportHeight - mobileFollowUpTopClearance)}px`
      : `calc(100vh - ${
          isMobile
            ? MOBILE_LATEST_SECTION_OFFSET_FALLBACK
            : DESKTOP_LATEST_SECTION_OFFSET
        }px)`

  // Extract citation maps from all messages in all sections
  const allCitationMaps = useMemo(() => {
    const allMessages: UIMessage[] = []
    sections.forEach(section => {
      allMessages.push(section.userMessage)
      allMessages.push(...section.assistantMessages)
    })
    return extractCitationMapsFromMessages(allMessages)
  }, [sections])

  if (!sections.length) return null

  // Keep the assistant logo visible for the latest section after generation
  const latestSection = sections[sections.length - 1]
  const showAssistantLogo = Boolean(
    latestSection && (isLoading || latestSection.assistantMessages.length > 0)
  )

  // Helper function to get tool count with caching
  const getToolCount = (message?: UIMessage): number => {
    if (!message || !message.id) return 0

    // During streaming, always recalculate
    if (isLoading) {
      const count =
        message.parts?.filter(part => toolTypes.includes(part.type)).length || 0
      return count
    }

    // Check cache first when not streaming
    const cached = toolCountCacheRef.current.get(message.id)
    if (cached !== undefined) {
      return cached
    }

    // Calculate and cache
    const count =
      message.parts?.filter(part => toolTypes.includes(part.type)).length || 0
    toolCountCacheRef.current.set(message.id, count)
    return count
  }

  const getIsOpen = (
    id: string,
    partType?: string,
    hasNextPart?: boolean,
    message?: UIMessage
  ) => {
    // If user has explicitly modified this state, use that
    if (userModifiedStates.hasOwnProperty(id)) {
      return userModifiedStates[id]
    }

    // For tool types, check if there are multiple tools
    if (partType && toolTypes.includes(partType)) {
      const toolCount = getToolCount(message)
      // If multiple tools exist, default to closed
      if (toolCount > 1) {
        return false
      }
      // Single tool results stay open even if more content follows
      return true
    }

    // For tool-invocations, default to open
    if (partType === 'tool-invocation') {
      return true
    }

    // For reasoning, auto-collapse if there's a next part in the same message
    if (partType === 'reasoning') {
      return !hasNextPart
    }

    // For other types (like text), default to open
    return true
  }

  const handleOpenChange = (id: string, open: boolean) => {
    setUserModifiedStates(prev => ({
      ...prev,
      [id]: open
    }))
  }

  return (
    <div
      id="scroll-container"
      ref={scrollContainerRef}
      role="list"
      aria-roledescription="chat messages"
      className={cn(
        'relative size-full pt-20 md:pt-14',
        sections.length > 0 ? 'flex-1 overflow-y-auto overflow-x-hidden' : ''
      )}
    >
      <div className="relative mx-auto w-full max-w-full md:max-w-3xl px-4">
        {sections.map((section, sectionIndex) => (
          <div
            key={section.id}
            id={`section-${section.id}`}
            className="chat-section scroll-mt-24 md:scroll-mt-14 pb-4 md:pb-14"
            style={
              sectionIndex === sections.length - 1
                ? { minHeight: latestSectionMinHeight }
                : {}
            }
          >
            {/* User message */}
            {(() => {
              const umParts = (section.userMessage.parts ?? []) as any[]
              const umFiles = umParts
                .filter((p: any) => p.type === 'file')
                .map((p: any) => ({
                  url: p.url,
                  name: p.filename || 'Unknown file',
                  mediaType: p.mediaType || 'application/octet-stream',
                  status: 'uploaded' as const
                }))
              const umHasText = umParts.some(
                (p: any) =>
                  (p.type === 'text' &&
                    typeof p.text === 'string' &&
                    p.text.trim().length > 0) ||
                  p.type === 'data-pastedContent' ||
                  p.type === 'data-quotedContext' ||
                  p.type === 'data-noteContext' ||
                  p.type === 'data-sourceUrl'
              )
              return (
                <div className="mb-2 md:mb-4 flex flex-col items-end">
                  {umFiles.length > 0 && (
                    <div className="w-fit max-w-[88%] md:max-w-[78%] mb-1.5">
                      <UploadedFileList
                        files={umFiles}
                        onRemove={() => {}}
                        readOnly
                      />
                    </div>
                  )}
                  {umHasText && (
                    <div className="w-fit max-w-[88%] md:max-w-[78%] rounded-[20px] bg-muted px-4 py-2.5">
                      <RenderMessage
                        message={section.userMessage}
                        messageId={section.userMessage.id}
                        hideUserFileList
                        getIsOpen={(id, partType, hasNextPart) =>
                          getIsOpen(id, partType, hasNextPart, section.userMessage)
                        }
                        onOpenChange={handleOpenChange}
                        chatId={chatId}
                        isGuest={isGuest}
                        isCloudDeployment={isCloudDeployment}
                        libraryAvailable={libraryAvailable}
                        status={status}
                        addToolResult={addToolResult}
                        onUpdateMessage={onUpdateMessage}
                        reload={reload}
                        citationMaps={allCitationMaps}
                        onQuoteContext={onQuoteContext}
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Assistant messages */}
            {section.assistantMessages.map((assistantMessage, messageIndex) => {
              // Check if this is the latest assistant message in the latest section
              const isLatestMessage =
                sectionIndex === sections.length - 1 &&
                messageIndex === section.assistantMessages.length - 1

              return (
                <div
                  key={assistantMessage.id}
                  className="flex flex-col gap-2 md:gap-4"
                >
                  <RenderMessage
                    message={assistantMessage}
                    messageId={assistantMessage.id}
                    getIsOpen={(id, partType, hasNextPart) =>
                      getIsOpen(id, partType, hasNextPart, assistantMessage)
                    }
                    onOpenChange={handleOpenChange}
                    chatId={chatId}
                    isGuest={isGuest}
                    isCloudDeployment={isCloudDeployment}
                    libraryAvailable={libraryAvailable}
                    status={status}
                    addToolResult={addToolResult}
                    onUpdateMessage={onUpdateMessage}
                    reload={reload}
                    isLatestMessage={isLatestMessage}
                    citationMaps={allCitationMaps}
                    onQuoteContext={onQuoteContext}
                  />
                </div>
              )
            })}
            {/* Show assistant logo and loading/footer message after assistant messages */}
            {showAssistantLogo && sectionIndex === sections.length - 1 && (
              <div className="flex items-center gap-3 py-1 md:py-4">
                <AnimatedLogo
                  className="size-10 shrink-0 text-foreground dark:text-white"
                  animate={isLoading}
                />
                {/* Shimmer label — appears only after 500ms in 'submitted' state
                    (tool-heavy requests) and fades out smoothly when
                    the first token arrives. opacity + max-height transition
                    gives a collapse effect so it doesn't leave a gap. */}
                <span
                  aria-hidden={!showNelthLabel}
                  style={{
                    opacity: showNelthLabel ? 1 : 0,
                    maxHeight: showNelthLabel ? '2rem' : '0',
                    overflow: 'hidden',
                    transition: 'opacity 350ms ease, max-height 350ms ease',
                    display: 'block',
                  }}
                >
                  {<NelthLoadingLabel activity={currentActivity} />}
                </span>
                {/* Footer tips — only shown when label is not active */}
                {!showNelthLabel && <ChatFooterMessage isLoading={isLoading} />}
              </div>
            )}
            {sectionIndex === sections.length - 1 && error && (() => {
              const hasDeliveredAssistantContent = section.assistantMessages.some(
                m =>
                  m.parts?.some(
                    (p: any) =>
                      p.type === 'text' && p.text && p.text.trim().length > 0
                  )
              )
              return !hasDeliveredAssistantContent ? (
                <ChatError error={error} />
              ) : null
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}
