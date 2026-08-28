import type { LangfuseSpan } from '@langfuse/tracing'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import type { UIMessage } from 'ai'
import { consumeStream, convertToModelMessages, smoothStream } from 'ai'

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
import { stripEmojiFromCodeInMessage } from '@/lib/skills/enforce-stream'
import {
  type AttachmentLike,
  extractAttachmentFormats} from '@/lib/skills/document-runtime'
import { getImageAttachmentUrl, getTextFromParts } from '@/lib/utils/message-utils'
import { search as runWebSearch } from '@/lib/tools/search'

import { isTracingEnabled } from '@/lib/utils/telemetry'

import {
  getMaxAllowedTokens,
  shouldTruncateMessages,
  truncateMessages
} from '../utils/context-window'
import { isUsageLogging, logUsage } from '../utils/usage-logging'

import { compactHistoricalMessages } from './helpers/compact-historical-messages'
import {
  convertDataPart,
  mapFilePartsToDataParts
} from './helpers/convert-data-part'
import { stripSpecFromMessages } from './helpers/strip-spec-from-messages'
import { BaseStreamConfig } from './types'

import { langfuseSpanProcessor } from '@/instrumentation'

type EphemeralStreamConfig = Pick<
  BaseStreamConfig,
  'model' | 'abortSignal' | 'searchMode'
> & {
  messages: UIMessage[]
  chatId?: string
}

export async function createEphemeralChatStreamResponse(
  config: EphemeralStreamConfig
): Promise<Response> {
  const { messages, model, abortSignal, searchMode, chatId } = config

  if (!messages || messages.length === 0) {
    return new Response('messages are required', {
      status: 400,
      statusText: 'Bad Request'
    })
  }

  const executeStream = async (rootSpan?: LangfuseSpan): Promise<Response> => {
    // Real OTel trace ID, sent to the client in message metadata so feedback
    // scores can be attached to this trace later
    const parentTraceId = rootSpan?.traceId

    const endTracing = async () => {
      if (rootSpan) {
        rootSpan.end()
        await langfuseSpanProcessor.forceFlush()
      }
    }

    try {
      const messagesWithoutSpec = stripSpecFromMessages(messages)
      const messagesToConvert = compactHistoricalMessages(messagesWithoutSpec)
      const messagesWithoutFileParts = mapFilePartsToDataParts(
        messagesToConvert
      )

      let modelMessages = await convertToModelMessages(
        messagesWithoutFileParts,
        {
          convertDataPart
        }
      )

      if (shouldTruncateMessages(modelMessages, model)) {
        const maxTokens = getMaxAllowedTokens(model)
        modelMessages = truncateMessages(modelMessages, maxTokens, model.id)
      }

      // Resolve the latest user query and run the Skill Router so the model
      // receives only the expertise relevant to THIS request.
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      const userQuery = lastUser ? getTextFromParts(lastUser.parts) : ''

      // Attachment-driven routing: collect document formats across all messages so
      // an uploaded pdf/docx/xlsx/pptx activates its skill even with no trigger.
      const fileParts = messages
        .flatMap(m => m.parts ?? [])
        .filter(p => p?.type === 'file')
      const attachmentFormats = extractAttachmentFormats(
        fileParts as AttachmentLike[]
      )

      // LEVEL 0 — fast, cheap capability detection (no SKILL.md loads). Decides
      // whether this request needs any skill or external tool BEFORE we spend time
      // routing/loading skills or arming the research agent. Falls back to an empty
      // context when nothing matches so the model streams immediately. Mirrors the
      // authenticated chat path so guests get the same lazy architecture.
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
        // Skill CONTINUITY: carry the previous turn's active skills + design
        // fingerprint so follow-ups ("another version") keep the skill active.
        // Only resolved when a skill is actually in play for this request.
        prevCtx = await getPreviousDesignContext(messages, lastUser?.id)
        skillCtx = await buildSkillContext(
          userQuery,
          'minimal',
          attachmentFormats,
          prevCtx.slugs,
          prevCtx.designSummary,
          prevCtx.previousCode,
          `${model.providerId}:${model.id}`.includes('tencent/hy3:free')
        )
      }

      // Assemble the skill context string only when a skill was loaded
      // (LEVEL 2 full SKILL.md). Empty otherwise → the model streams immediately.
      const skillContext =
        skillCtx?.operationalPrompt
          ? `${skillCtx.context}\n\n${skillCtx.operationalPrompt}`
          : skillCtx?.context ?? ''

      // Detect an uploaded image in the latest user message so generateImage
      // forces the image-to-image route instead of text-to-image.
      const lastUserMessage = [...messages]
        .reverse()
        .find(m => m.role === 'user')
      const imageAttachment = lastUserMessage?.parts
        ? getImageAttachmentUrl(lastUserMessage.parts)
        : undefined
      if (imageAttachment) {
        console.log('[ImageEdit] reference image detected in guest message')
      }

      const researchAgent = researcher({
        model: `${model.providerId}:${model.id}`,
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

      const modelId = `${model.providerId}:${model.id}`
      const result = await researchAgent.stream({
        messages: modelMessages,
        abortSignal,
        experimental_transform: smoothStream({ chunking: 'word' }),
        ...(isUsageLogging() && {
          onStepFinish: step => {
            logUsage(
              { scope: 'step', modelId },
              step.usage,
              step.providerMetadata
            )
          }
        })
      })
      result.consumeStream()

      if (isUsageLogging()) {
        Promise.resolve(result.totalUsage)
          .then(usage => logUsage({ scope: 'total', modelId }, usage))
          .catch(() => {})
      }

      return result.toUIMessageStreamResponse({
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return {
              traceId: parentTraceId,
              searchMode,
              modelId: `${model.providerId}:${model.id}`
            }
          }
        },
        onFinish: ({ responseMessage }) => {
          // Attach preloaded web-search results as a synthetic `tool-search` part
          // so the Sources panel and inline citation map persist with the message.
          // Attached here (not in the live SSE stream) because a bare tool part
          // first breaks stricter SSE clients (e.g. mobile).
          if (
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
          // Numero 1: guarantee NO emoji leaks into any generated code/artifact
          // (emoji-as-UI-icon) for guest chats too. Conversational text outside
          // code blocks is preserved.
          if (responseMessage) stripEmojiFromCodeInMessage(responseMessage)
          // Do not block the SSE stream closure on the tracing flush: if
          // Langfuse is unreachable, awaiting forceFlush would keep the
          // response open and the UI stuck on "Répondre…".
          void endTracing()
        },
        onError: (error: unknown) => {
          console.error('Ephemeral stream response error:', error)
          return serializePublicError(error)
        },
        consumeSseStream: consumeStream
      })
    } catch (error) {
      await endTracing()
      console.error('Ephemeral stream execution error:', error)
      return createPublicErrorResponse(error, {
        status: 500,
        statusText: 'Internal Server Error'
      })
    }
  }

  if (!isTracingEnabled()) {
    return executeStream()
  }

  // Wrap execution in a root Langfuse observation so all spans share a
  // single trace
  return propagateAttributes(
    {
      traceName: 'research',
      userId: 'guest',
      ...(chatId && { sessionId: chatId }),
      metadata: {
        ...(chatId && { chatId }),
        userId: 'guest',
        modelId: `${model.providerId}:${model.id}`,
        trigger: 'submit-message'
      }
    },
    () =>
      startActiveObservation('research', span => executeStream(span), {
        endOnExit: false
      })
  )
}
