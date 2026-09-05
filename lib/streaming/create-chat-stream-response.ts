import type { LangfuseSpan } from '@langfuse/tracing'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream
} from 'ai'

import { researcher } from '@/lib/agents/researcher'
import {
  type ConnectorPreloadCall,
  detectConnectorIntent
} from '@/lib/connectors/context'
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
import { resolveConversationLanguage } from '@/lib/skills/language-memory'
import { isTracingEnabled } from '@/lib/utils/telemetry'

import { loadChat } from '../actions/chat'
import { generateChatTitle } from '../agents/title-generator'
import { search as runWebSearch } from '../tools/search'
import {
  getMaxAllowedTokens,
  shouldTruncateMessages,
  truncateMessages
} from '../utils/context-window'
import {
  getImageAttachmentUrl,
  getTextFromParts,
  resolveContextualSearchQuery,
  StreamTextSanitizer,
  stripFakeToolCallXmlFromMessage
} from '../utils/message-utils'
import { perfLog, perfTime } from '../utils/perf-logging'
import { isUsageLogging, logUsage } from '../utils/usage-logging'

import { compactHistoricalMessages } from './helpers/compact-historical-messages'
import {
  convertDataPart,
  mapFilePartsToDataParts
} from './helpers/convert-data-part'
import { normalizeConversationHistory } from './helpers/normalize-conversation'
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
      const preparedMessages = await prepareMessages(context, message)
      // Authoritative history normalization: exactly-once current message,
      // no duplicates, no contentless turns — chronological order preserved.
      const { messages: messagesToModel } =
        normalizeConversationHistory(preparedMessages)
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

      // Nelth-3.5 (tencent/hy3:free) is a non-thinking model: the Kilo gateway
      // ALWAYS returns a `reasoning` field (reasoning_tokens is never 0, and no
      // request param can disable it server-side). It also cannot emit valid
      // native tool calls — it outputs fake <tool_call> XML blocks. So for this
      // model we ALWAYS preload search results for non-trivial queries (unless
      // the capability detector already flagged needsSearch, in which case we
      // preload too). This prevents the model from hallucinating current info
      // it no longer has in its weights.
      const isNonThinkingModel =
        model.id === 'tencent/hy3:free' || model.id === 'minimax/minimax-m3:free'

      // A skill is needed only when one matched (LEVEL 1) or an attachment forces
      // it (e.g. an uploaded document). Everything else (greetings, simple chat,
      // translations, plain explanations) skips skill loading and the research
      // agent entirely.
      const skillNeeded =
        caps.candidateSkillSlugs.length > 0 || attachmentFormats.length > 0

      // Detect an uploaded image in the current user message BEFORE the `trivial`
      // gate below. The generateImage tool needs it to force the image-to-image
      // route (restyle/edit the photo in place) instead of text-to-image. If this
      // is computed only AFTER `trivial`, an image upload is wrongly treated as a
      // trivial request and ALL tools (incl. generateImage) get disarmed — so the
      // model falls back to the web search tool.
      const imageAttachment = message?.parts
        ? getImageAttachmentUrl(message.parts)
        : undefined
      if (imageAttachment) {
        console.log('[ImageEdit] reference image detected in chat message')
      }
      // Effective image intent: explicit text intent OR an attached image.
      const needsImageEff = caps.needsImage || Boolean(imageAttachment)

      const trivial =
        !caps.needsSearch &&
        !needsImageEff &&
        !caps.needsDocument &&
        !caps.founderPhoto &&
        !skillNeeded

      // Preloaded search: the weak non-thinking model cannot emit a valid native
      // tool call — it outputs a fake <tool_call> XML block and the agent retries
      // in a loop. So we fetch results server-side and feed them as text. To still
      // show citations, we ALSO surface these results as a synthetic `tool-search`
      // UI part in the stream (see below), which drives the Sources panel and the
      // Preloaded search: when the request requires web search (caps.needsSearch
      // is true), we fetch results server-side and provide them directly to the model.
      // We ALSO surface these results as synthetic tool chunks in the stream so the
      // UI displays the search process, Sources panel, and inline citations.
      // Connector-first: when the turn targets the user's OWN connected apps
      // (Gmail, Drive, Calendar, GitHub, Notion), a web search is the wrong
      // move — the answer lives in their accounts, not on the public web.
      // Skip the server-side web preload so the researcher arms the connector
      // tools (or the connector preload for the weak model) instead. Guests
      // have no vault, so the preload stays for them.
      const connectorDataIntent =
        detectConnectorIntent(userQuery ?? '') &&
        Boolean(userId) &&
        userId !== 'guest'
      const shouldPreloadSearch =
        Boolean(caps.needsSearch) && !connectorDataIntent
      let preloadedSearchContext: string | undefined
      let preloadedSearchQuery: string | undefined
      let searchResultsForCitation: Awaited<ReturnType<typeof runWebSearch>> | undefined
      if (shouldPreloadSearch) {
        const effectiveSearchQuery = resolveContextualSearchQuery(
          userQuery,
          messagesToModel
        )
        preloadedSearchQuery = effectiveSearchQuery
        const searchResult = await runWebSearch(
          effectiveSearchQuery,
          // Web count only — the provider always fetches 20 images in parallel
          // when 'image' is requested, so image searches get BOTH web + images.
          isNonThinkingModel ? 7 : 10,
          'basic',
          [],
          [],
          caps.webImageSearch ? ['image', 'web'] : ['web']
        )
        preloadedSearchContext = searchResult.results
          .map(
            (result, i) =>
              `[${i + 1}] ${result.title}: ${result.url}\n  ${result.content}`
          )
          .join('\n\n')
        if (searchResult.images && searchResult.images.length > 0) {
          // Images are numbered (IMG-i) in their OWN space so the model never
          // confuses them with the [n] web-result citations.
          const imageLines = searchResult.images
            .map((image, i) => {
              const imageUrl = typeof image === 'string' ? image : image.url
              const imageData =
                typeof image === 'string'
                  ? { url: imageUrl }
                  : {
                      url: imageUrl,
                      ...(image.sourceUrl && { sourceUrl: image.sourceUrl }),
                      ...(image.title && { title: image.title }),
                      ...(image.description && {
                        description: image.description
                      })
                    }
              return `(IMG-${i + 1}) ${JSON.stringify(imageData)}`
            })
            .join('\n')
          preloadedSearchContext += `\n\nIMAGES DISPONIBLES (numérotées IMG-1, IMG-2, ... — espace SÉPARÉ des citations [n]):\n${imageLines}\nDIRECTIVE POUR LES RECHERCHES D'IMAGES: affiche au maximum 3 images pertinentes directement avec la syntaxe Markdown ![légende](url) — UNE IMAGE PAR LIGNE, rien d'autre sur la ligne — puis une section « 📋 Sources » façon ChatGPT : liste numérotée de liens cliquables au format EXACT \`1. [Titre court — Nom du site](URL exacte)\` — JAMAIS d'URL brute affichée en texte. RÈGLES STRICTES: (1) Présente les images choisies DANS L'ORDRE CROISSANT des numéros IMG, sans réordonner ni mélanger. (2) Chaque légende reprend EXACTEMENT le titre/description fourni — n'invente aucune légende. (3) Copie chaque URL EXACTEMENT sans la modifier. (4) N'ajoute AUCUN marqueur de citation [n] dans la phrase d'intro, les légendes ou la section « 📋 Sources » des images — les liens sources suffisent. (5) Ne montre JAMAIS les 20 images, n'utilise aucun bloc spec ni grille. (6) N'écris JAMAIS "Image not available" ni aucun texte de remplacement : si une image ne convient pas, ignore-la silencieusement. Ne dis pas que les images sont indisponibles. (7) Les marqueurs [n] sont INTERDITS sauf s'ils correspondent à un résultat web numéroté réellement fourni ci-dessus — ne JAMAIS inventer de numéros de citation ; sans résultats web, aucun [n].`
        }
        searchResultsForCitation = searchResult
      }

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

      // Active conversation language (persisted preference from history or
      // current request): injected near the top of the system instructions
      // so it holds for BOTH models every turn.
      const conversationLanguage = resolveConversationLanguage(
        messagesToModel,
        userQuery
      )

      // Connector preload sink: for the weak model the researcher fetches
      // Gmail/Drive/… server-side; the structured calls land here so they can
      // be surfaced as synthetic tool parts below (same UX as native calls).
      const connectorPreloadCalls: ConnectorPreloadCall[] = []

      // Get the researcher agent with search mode. `imageAttachment` / `needsImageEff`
      // are already resolved above, before the `trivial` gate.
      const researchAgent = await researcher({
        model: context.modelId,
        modelConfig: model,
        searchMode,
        skillContext,
        preloadedSearchContext,
        preloadedSearchQuery,
        conversationLanguage,
        imageAttachment,
        userQuery,
        userId,
        connectorCallsSink: connectorPreloadCalls,
        capabilities: {
          trivial,
          needsSearch: caps.needsSearch && !preloadedSearchContext,
          needsImage: needsImageEff,
          needsDocument: caps.needsDocument
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
      // Log the session-total usage once the stream settles (does not block the
      // response; the reader below drives the agent stream to completion).
      if (isUsageLogging()) {
        Promise.resolve(result.totalUsage)
          .then(usage =>
            logUsage({ scope: 'total', modelId: context.modelId }, usage)
          )
          .catch(() => {})
      }

      const agentStream = result.toUIMessageStream()

      // Surface the preloaded web-search results as synthetic tool chunks
      // so the Sources panel and inline citation map render LIVE.
      const syntheticSearchInputChunk = {
        type: 'tool-input-available' as const,
        toolCallId: 'preloaded-search',
        toolName: 'search',
        input: {
          query: userQuery,
          type: 'optimized',
          content_types: caps.webImageSearch ? ['image', 'web'] : ['web'],
          max_results: 10,
          search_depth: 'basic'
        }
      }
      const syntheticSearchOutputChunk = {
        type: 'tool-output-available' as const,
        toolCallId: 'preloaded-search',
        output: { ...searchResultsForCitation, state: 'complete' }
      }

      // Surface the preloaded CONNECTOR results as synthetic tool chunks
      // (tool-gmail, tool-drive, …) so Nelth-3.5 renders the same activity
      // shimmer + result sections as models with native tool calls.
      const syntheticConnectorChunks = connectorPreloadCalls.flatMap(call => {
        const toolCallId = `preloaded-${call.service}`
        return [
          {
            type: 'tool-input-available' as const,
            toolCallId,
            toolName: call.service,
            input: call.input
          },
          {
            type: 'tool-output-available' as const,
            toolCallId,
            output: call.output
          }
        ]
      })

      // isNonThinkingModel is declared earlier in the function (before the
      // preloaded search block). It is used here to filter reasoning parts from
      // the stream so the client never receives or persists them.

      // Tracks whether any answer content was streamed to the client. If real
      // answer content was already delivered, a trailing stream error (e.g. a
      // transient gateway hiccup AFTER the text completed, or an error part
      // emitted by the agent stream) must NOT replace the delivered answer
      // with "We could not generate a response".
      let wroteContent = false
      let writtenPartCount = 0

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          try {
            const reader = (
              agentStream as unknown as ReadableStream<unknown>
            ).getReader()
            let searchChunksEmitted = false
            let connectorChunksEmitted = false
            // Mid-conversation: strip any leading greeting-reset intro fluff
            // ("Salut ! ... Je suis Nelth-IA ...") the weak model prepends to
            // every answer. No prior assistant message = keep greetings.
            const textSanitizer = new StreamTextSanitizer({
              stripLeadingIntroReset: modelMessages.some(
                m => m.role === 'assistant'
              ),
              userQuery
            })

            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                const remaining = textSanitizer.flush()
                if (remaining) {
                  writer.write({
                    type: 'text-delta',
                    id: 'txt-0',
                    delta: remaining
                  } as unknown as Parameters<typeof writer.write>[0])
                  wroteContent = true
                  writtenPartCount++
                }
                break
              }
              const part = value as
                | { type?: string; delta?: string; id?: string }
                | undefined

              // Pass stream start through first, then immediately emit the preloaded
              // search results so the client renders the search card and sources
              // before text generation begins
              if (
                part &&
                typeof part.type === 'string' &&
                (part.type === 'start' || part.type === 'start-step')
              ) {
                writer.write(
                  value as unknown as Parameters<typeof writer.write>[0]
                )
                writtenPartCount++

                if (
                  !searchChunksEmitted &&
                  searchResultsForCitation &&
                  (searchResultsForCitation.results.length > 0 ||
                    searchResultsForCitation.images.length > 0 ||
                    (searchResultsForCitation.videos?.length ?? 0) > 0)
                ) {
                  searchChunksEmitted = true
                  writer.write(
                    syntheticSearchInputChunk as unknown as Parameters<
                      typeof writer.write
                    >[0]
                  )
                  writer.write(
                    syntheticSearchOutputChunk as unknown as Parameters<
                      typeof writer.write
                    >[0]
                  )
                  writtenPartCount += 2
                }
                // Same treatment for preloaded connector calls: emit the
                // synthetic tool-gmail / tool-drive / … parts first so the
                // client renders the connector activity + results live.
                if (
                  !connectorChunksEmitted &&
                  syntheticConnectorChunks.length > 0
                ) {
                  connectorChunksEmitted = true
                  for (const chunk of syntheticConnectorChunks) {
                    writer.write(
                      chunk as unknown as Parameters<typeof writer.write>[0]
                    )
                    writtenPartCount++
                  }
                }
                continue
              }

              if (
                isNonThinkingModel &&
                part &&
                typeof part.type === 'string' &&
                part.type.includes('reasoning')
              ) {
                continue
              }

              // Real-time filtering of fake XML tool-call text leaks
              if (
                part &&
                part.type === 'text-delta' &&
                typeof part.delta === 'string'
              ) {
                const cleanDelta = textSanitizer.process(part.delta)
                if (cleanDelta) {
                  writer.write({
                    ...part,
                    delta: cleanDelta
                  } as unknown as Parameters<typeof writer.write>[0])
                  writtenPartCount++
                  wroteContent = true
                }
                continue
              }

              // Skip error parts emitted by the agent stream — they would
              // otherwise be written to the client and rendered as
              // "We could not generate a response" even when real answer
              // content was already delivered.
              if (
                part &&
                typeof part.type === 'string' &&
                (part.type === 'error' || part.type.endsWith('-error'))
              ) {
                console.error(
                  '[Stream] skipping error part from agent stream:',
                  part
                )
                continue
              }
              writer.write(
                value as unknown as Parameters<typeof writer.write>[0]
              )
              writtenPartCount++
              if (
                part &&
                typeof part.type === 'string' &&
                part.type === 'text'
              ) {
                wroteContent = true
              }
            }
          } catch (streamErr) {
            console.error(
              '[Stream] error after content streamed=' + wroteContent + ':',
              streamErr
            )
            if (!wroteContent) {
              throw streamErr
            }
          }
        },
        onError: (error: unknown) => {
          console.error(
            'Stream response error (wroteContent=' +
              wroteContent +
              ', parts=' +
              writtenPartCount +
              '):',
            error
          )
          if (wroteContent || writtenPartCount > 0) {
            console.error(
              '[Stream] error suppressed — content already delivered; not surfacing to user'
            )
            return ''
          }
          return serializePublicError(error)
        },
        onFinish: ({ responseMessage, isAborted }) => {
          // Also persist the synthetic tool-search part so the Sources panel and
          // inline citation map survive a reload. Same condition as the live
          // emit above: results, images OR videos (image-only searches must
          // survive too).
          if (
            !isAborted &&
            responseMessage &&
            searchResultsForCitation &&
            (searchResultsForCitation.results.length > 0 ||
              searchResultsForCitation.images.length > 0 ||
              (searchResultsForCitation.videos?.length ?? 0) > 0)
          ) {
            const hasSearch = responseMessage.parts?.some(
              (p: any) => p.type === 'tool-search'
            )
            if (!hasSearch) {
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
          }
          // Also persist the synthetic connector parts so the connector
          // sections survive a reload. Same condition as the live emit above.
          if (
            !isAborted &&
            responseMessage &&
            connectorPreloadCalls.length > 0
          ) {
            for (const call of connectorPreloadCalls) {
              const partType = `tool-${call.service}`
              const hasPart = responseMessage.parts?.some(
                (p: any) => p.type === partType
              )
              if (!hasPart) {
                responseMessage.parts = [
                  ...(responseMessage.parts ?? []),
                  {
                    type: partType,
                    toolCallId: `preloaded-${call.service}`,
                    state: 'output-available',
                    input: call.input,
                    output: call.output
                  } as unknown as (typeof responseMessage.parts)[number]
                ]
              }
            }
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

              // Strip fake <tool_call> / <function> XML blocks the weak model
              // emits as text instead of native tool calls — they would otherwise
              // leak into the final answer as raw markup.
              stripFakeToolCallXmlFromMessage(responseMessage)

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
        }
      })

      return createUIMessageStreamResponse({
        stream,
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
