import type { LangfuseSpan } from '@langfuse/tracing'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import {
  consumeStream,
  convertToModelMessages,
  smoothStream
} from 'ai'

import { researcher } from '@/lib/agents/researcher'
import {
  createPublicErrorResponse,
  serializePublicError
} from '@/lib/errors/public-error'
import {
  buildSkillContext,
  getPreviousDesignContext
} from '@/lib/skills/build-skill-context'
import { detectRequestCapabilities } from '@/lib/skills/capability-detection'
import {
  type AttachmentLike,
  extractAttachmentFormats} from '@/lib/skills/document-runtime'
import {
  enforceSkillOutput,
  stripEmojiFromCodeInMessage
} from '@/lib/skills/enforce-stream'
import { isTracingEnabled } from '@/lib/utils/telemetry'

import { loadChat } from '../actions/chat'
import { generateChatTitle } from '../agents/title-generator'
import {
  getMaxAllowedTokens,
  shouldTruncateMessages,
  truncateMessages
} from '../utils/context-window'
import { getImageAttachmentUrl, getTextFromParts } from '../utils/message-utils'
import { search as runWebSearch } from '../tools/search'
import { perfLog, perfTime } from '../utils/perf-logging'
import { isUsageLogging, logUsage } from '../utils/usage-logging'

import { compactHistoricalMessages } from './helpers/compact-historical-messages'
import {
  convertDataPart,
  mapFilePartsToDataParts
} from './helpers/convert-data-part'
import { persistStreamResults } from './helpers/persist-stream-results'
import { prepareMessages } from './helpers/prepare-messages'
import { stripSpecFromMessages } from './helpers/strip-spec-from-messages'
import type { StreamContext } from './helpers/types'
import { BaseStreamConfig } from './types'

import { langfuseSpanProcessor } from '@/instrumentation'

// Constants
const DEFAULT_CHAT_TITLE = 'Untitled'

/**
 * Best-effort extraction of the user query for routing when the submitted
 * `message` is unavailable (e.g. regenerate triggers). Prefers the message
 * matching `messageId`, otherwise the most recent user message in the chat.
 */
function deriveQueryFromChat(
  chat: Awaited<ReturnType<typeof loadChat>> | null,
  messageId?: string
): string {
  const messages = chat?.messages
  if (!messages || messages.length === 0) return ''

  const target = messageId
    ? messages.find(m => m.id === messageId)
    : [...messages].reverse().find(m => m.role === 'user')

  if (!target) return ''
  // DB messages store parts as { type, text } which getTextFromParts accepts.
  return getTextFromParts((target as { parts?: unknown }).parts as never)
}

export async function createChatStreamResponse(
  config: BaseStreamConfig
): Promise<Response> {
  const {
    message,
    model,
    chatId,
    userId,
    trigger,
    messageId,
    abortSignal,
    isNewChat,
    searchMode
  } = config

  // Verify that chatId is provided
  if (!chatId) {
    return new Response('Chat ID is required', {
      status: 400,
      statusText: 'Bad Request'
    })
  }

  // Skip loading chat for new chats optimization
  let initialChat = null
  if (!isNewChat) {
    const loadChatStart = performance.now()
    // Fetch chat data for authorization check and cache it
    initialChat = await loadChat(chatId, userId)
    perfTime('loadChat completed', loadChatStart)

    // Authorization check: if chat exists, it must belong to the user
    if (initialChat && initialChat.userId !== userId) {
      return new Response('You are not allowed to access this chat', {
        status: 403,
        statusText: 'Forbidden'
      })
    }
  } else {
    perfLog('loadChat skipped for new chat')
  }

  const executeStream = async (rootSpan?: LangfuseSpan): Promise<Response> => {
    // Real OTel trace ID, stored in message metadata so feedback scores can
    // be attached to this trace later
    const parentTraceId = rootSpan?.traceId

    const endTracing = async () => {
      if (rootSpan) {
        rootSpan.end()
        await langfuseSpanProcessor.forceFlush()
      }
    }

    // Create stream context with trace ID
    const context: StreamContext = {
      chatId,
      userId,
      modelId: `${model.providerId}:${model.id}`,
      messageId,
      trigger,
      initialChat,
      abortSignal,
      parentTraceId,
      isNewChat
    }

    // Declare titlePromise in outer scope for onFinish access
    let titlePromise: Promise<string> | undefined

    try {
      // Prepare messages for the model
      const prepareStart = performance.now()
      perfLog(
        `prepareMessages - Invoked: trigger=${trigger}, isNewChat=${isNewChat}`
      )
      const messagesToModel = await prepareMessages(context, message)
      perfTime('prepareMessages completed (stream)', prepareStart)

      // Resolve the latest user query and run the Skill Router so the model
      // receives only the expertise relevant to THIS request (progressive
      // disclosure). Falls back to an empty context when nothing matches.
      const userQuery =
        (message && getTextFromParts(message.parts)) ||
        deriveQueryFromChat(context.initialChat, messageId) ||
        ''

      // Attachment-driven routing: an uploaded document (pdf/docx/xlsx/pptx) must
      // activate its skill even when the query has no matching trigger. The file
      // content itself is the signal. Reuses the existing router.
      const attachmentFormats = message?.parts
        ? extractAttachmentFormats(
            message.parts.filter(p => p?.type === 'file') as AttachmentLike[]
          )
        : []

      // LEVEL 0 — fast, cheap capability detection (no SKILL.md loads). Decides
      // whether this request needs any skill or external tool BEFORE we spend time
      // routing/loading skills or arming the research agent. Falls back to an empty
      // context when nothing matches so the model streams immediately.
      const caps = await detectRequestCapabilities(userQuery, attachmentFormats)
      // Preloaded search: the weak/reasoning models (e.g. Nelth-3.5 Thinking)
      // cannot emit a valid native tool call — they output a fake <tool_call> XML
      // block and the agent retries in a loop. So we fetch results server-side and
      // feed them as text. To still show citations, we ALSO surface these results
      // as a synthetic `tool-search` UI part in the stream (see below), which drives
      // the Sources panel and the inline citation map.
      let preloadedSearchContext: string | undefined
      let searchResultsForCitation: Awaited<ReturnType<typeof runWebSearch>> | undefined
      if (caps.needsSearch) {
        const searchResult = await runWebSearch(userQuery, 10, 'basic')
        preloadedSearchContext = searchResult.results
          .map(result => `- ${result.title}: ${result.url}\n  ${result.content}`)
          .join('\n')
        searchResultsForCitation = searchResult
      }

      // A skill is needed only when one matched (LEVEL 1) or an attachment forces
      // it (e.g. an uploaded document). Everything else (greetings, simple chat,
      // translations, plain explanations) skips skill loading and the research
      // agent entirely.
      const skillNeeded =
        caps.candidateSkillSlugs.length > 0 || attachmentFormats.length > 0
      const trivial =
        !caps.needsSearch &&
        !caps.needsImage &&
        !caps.needsDocument &&
        !caps.founderPhoto &&
        !skillNeeded

      let prevCtx: Awaited<ReturnType<typeof getPreviousDesignContext>> = {
        slugs: [],
        designSummary: '',
        previousCode: ''
      }
      let skillCtx: Awaited<ReturnType<typeof buildSkillContext>> | null = null

      if (skillNeeded) {
        // Skill CONTINUITY: reuse the previous turn's active skills only when a
        // skill is actually in play for this request.
        const tPrevCtx = performance.now()
        prevCtx = await getPreviousDesignContext(messagesToModel, message?.id)
        perfTime('[TTFT] previous-design context resolved', tPrevCtx)

        // NOTE: do NOT pass `compact` (checklist-only) for the weak non-thinking
        // Nelth-3.5 model. Empirically the checklist-only context makes it ignore
        // the artifact rules and emit a "design brief" (prose plan + code
        // fragments + emoji headers) instead of the COMPLETE code. Feeding the
        // FULL SKILL.md (minimal mode, compact=false) gives it the explicit,
        // authoritative "output ONLY the runnable artifact" constraints it
        // actually follows.
        const tSkillCtx = performance.now()
        skillCtx = await buildSkillContext(
          userQuery,
          'minimal',
          attachmentFormats,
          prevCtx.slugs,
          prevCtx.designSummary,
          prevCtx.previousCode,
          false
        )
        perfTime('[TTFT] skill context built', tSkillCtx)
      }

      // Assemble the skill context string only when a skill was loaded
      // (LEVEL 2 full SKILL.md). Empty otherwise → the model streams immediately.
      const skillContext =
        skillCtx?.operationalPrompt
          ? `${skillCtx.context}\n\n${skillCtx.operationalPrompt}`
          : skillCtx?.context ?? ''

      // Get the researcher agent with search mode
      // Detect an uploaded image in the current user message so the
      // generateImage tool can force the image-to-image route (restyle/edit the
      // photo in place) instead of a from-scratch text-to-image generation.
      const imageAttachment = message?.parts
        ? getImageAttachmentUrl(message.parts)
        : undefined
      if (imageAttachment) {
        console.log('[ImageEdit] reference image detected in chat message')
      }

      const researchAgent = researcher({
        model: context.modelId,
        modelConfig: model,
        searchMode,
        skillContext,
        preloadedSearchContext,
        imageAttachment,
        userQuery,
        capabilities: {
          trivial,
          needsSearch: caps.needsSearch && !preloadedSearchContext,
          needsImage: caps.needsImage || Boolean(imageAttachment)
        }
      })

      const messagesWithoutSpec = stripSpecFromMessages(messagesToModel)
      const messagesToConvert = compactHistoricalMessages(messagesWithoutSpec)
      const messagesWithoutFileParts = mapFilePartsToDataParts(
        messagesToConvert
      )

      // Convert to model messages and apply context window management
      let modelMessages = await convertToModelMessages(
        messagesWithoutFileParts,
        {
          convertDataPart
        }
      )

      if (shouldTruncateMessages(modelMessages, model)) {
        const maxTokens = getMaxAllowedTokens(model)
        const originalCount = modelMessages.length
        modelMessages = truncateMessages(modelMessages, maxTokens, model.id)

        if (process.env.NODE_ENV === 'development') {
          console.log(
            `Context window limit reached. Truncating from ${originalCount} to ${modelMessages.length} messages`
          )
        }
      }

      // Start title generation in parallel if it's a new chat
      if (!initialChat && message) {
        const userContent = getTextFromParts(message.parts)
        titlePromise = generateChatTitle({
          userMessageContent: userContent,
          modelId: context.modelId,
          abortSignal
        }).catch(error => {
          console.error('Error generating title:', error)
          return DEFAULT_CHAT_TITLE
        })
      }

      const llmStart = performance.now()
      perfLog(
        `researchAgent.stream - Start: model=${context.modelId}, searchMode=${searchMode}`
      )
      const result = await researchAgent.stream({
        messages: modelMessages,
        abortSignal,
        experimental_transform: smoothStream({ chunking: 'word' }),
        ...(isUsageLogging() && {
          onStepFinish: step => {
            logUsage(
              { scope: 'step', modelId: context.modelId },
              step.usage,
              step.providerMetadata
            )
          }
        })
      })
      perfTime('[TTFT] model request sent (T4)', llmStart)
      result.consumeStream()

      // Log the session-total usage once the stream settles (does not block the
      // response; consumeStream above already drives it to completion).
      if (isUsageLogging()) {
        Promise.resolve(result.totalUsage)
          .then(usage =>
            logUsage({ scope: 'total', modelId: context.modelId }, usage)
          )
          .catch(() => {})
      }

      return result.toUIMessageStreamResponse({
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return {
              traceId: parentTraceId,
              searchMode,
              modelId: context.modelId
            }
          }
        },
        onFinish: ({ responseMessage, isAborted }) => {
          // Attach preloaded web-search results as a synthetic `tool-search` part
          // so the Sources panel and inline citation map persist with the message.
          // The model never invokes the search tool (it can't emit a valid native
          // tool call), so no real tool part exists; without this, a reload would
          // lose both the Sources list and the inline citations. We attach it here
          // (not into the live SSE stream) because writing a bare tool part first
          // breaks stricter SSE clients (e.g. mobile).
          if (
            !isAborted &&
            responseMessage &&
            searchResultsForCitation &&
            searchResultsForCitation.results.length > 0
          ) {
            responseMessage.parts = [
              ...(responseMessage.parts ?? []),
              {
                type: 'tool-search',
                toolCallId: 'preloaded-search',
                state: 'output-available',
                input: {
                  query: userQuery,
                  type: 'optimized',
                  content_types: ['web'],
                  max_results: 10,
                  search_depth: 'basic'
                },
                output: { ...searchResultsForCitation, state: 'complete' }
              } as unknown as (typeof responseMessage.parts)[number]
            ]
          }
          // Post-processing (skill enforcement, Firebase/DB persistence, tracing
          // flush) runs in the background and does NOT block the SSE stream from
          // closing. If any of these hang — e.g. an unreachable Firebase/Langfuse
          // endpoint in local mode — the response body would otherwise stay open
          // and the UI would remain stuck on "Répondre…" even though the answer
          // is already fully displayed. The stream closes immediately after the
          // text, and persistence continues asynchronously (best-effort).
          void (async () => {
            try {
              perfTime('researchAgent.stream completed', llmStart)
              if (isAborted || !responseMessage) return

              // ENFORCEMENT: validate the generated answer against active skills.
              // If it fails, refine it in place (bounded loop) before persisting.
              // Only runs when a skill was actually loaded for this request.
              if (skillCtx && skillCtx.activated.length > 0) {
                try {
                  await enforceSkillOutput({
                    responseMessage,
                    userQuery,
                    skillCtx,
                    model: context.modelId,
                    modelConfig: model,
                    searchMode,
                    modelMessages
                  })
                } catch (enfErr) {
                  console.error('Skill enforcement error (kept original):', enfErr)
                }
              }

              // Numero 1: guarantee NO emoji leaks into any generated code/artifact
              // (emoji-as-UI-icon), independent of active skills — the weak model
              // re-inserts them even for plain code requests. Conversational text
              // outside code blocks is preserved (legitimate on-page emoji stay).
              stripEmojiFromCodeInMessage(responseMessage)

              // Persist stream results to database (best-effort, non-blocking)
              await persistStreamResults(
                responseMessage,
                chatId,
                userId,
                titlePromise,
                parentTraceId,
                searchMode,
                context.modelId,
                context.pendingInitialSave,
                context.pendingInitialUserMessage,
                context.userMessageId
              )
            } catch (err) {
              console.error('onFinish post-processing error:', err)
            } finally {
              await endTracing()
            }
          })()
        },
        onError: (error: unknown) => {
          console.error('Stream response error:', error)
          return serializePublicError(error)
        },
        consumeSseStream: consumeStream
      })
    } catch (error) {
      await endTracing()
      console.error('Stream execution error:', error)
      return createPublicErrorResponse(error, {
        status: 500,
        statusText: 'Internal Server Error'
      })
    }
  }

  if (!isTracingEnabled()) {
    return executeStream()
  }

  // Wrap execution in a root Langfuse observation so the researcher and
  // title-generation spans share a single trace
  return propagateAttributes(
    {
      traceName: 'research',
      userId,
      sessionId: chatId,
      metadata: {
        chatId,
        userId,
        modelId: `${model.providerId}:${model.id}`,
        ...(trigger && { trigger })
      }
    },
    () =>
      startActiveObservation('research', span => executeStream(span), {
        endOnExit: false
      })
  )
}
