import { UIMessage } from 'ai'

import { createChatWithFirstMessage, upsertMessage } from '@/lib/actions/chat'
import { findExistingAssistantId, updateChatTitle } from '@/lib/db/actions'
import { SearchMode } from '@/lib/types/search'
import { perfTime } from '@/lib/utils/perf-logging'
import { retryDatabaseOperation } from '@/lib/utils/retry'

const DEFAULT_CHAT_TITLE = 'Untitled'

/**
 * Persists the just-streamed turn (idempotent assistant upsert). AWAITED by
 * the stream onFinish BEFORE the response closes: the composer unlocks the
 * moment the stream closes, so a background (non-awaited) save races the
 * user's next message — its history load would miss this turn and the model
 * would answer "oui" with no memory of what it just did. A DB upsert costs
 * ~100-500ms; correctness beats that latency. Title update stays
 * best-effort background (it waits on an LLM call).
 */
export async function persistStreamMessages(
  responseMessage: UIMessage,
  chatId: string,
  userId: string,
  parentTraceId?: string,
  searchMode?: SearchMode,
  modelId?: string,
  initialSavePromise?: Promise<
    Awaited<ReturnType<typeof createChatWithFirstMessage>>
  >,
  initialUserMessage?: UIMessage,
  userMessageId?: string
) {
  // Attach metadata to the response message
  responseMessage.metadata = {
    ...(responseMessage.metadata || {}),
    ...(parentTraceId && { traceId: parentTraceId }),
    ...(searchMode && { searchMode }),
    ...(modelId && { modelId })
  }

  // Idempotent assistant persistence: if an assistant message already exists for
  // this user turn (e.g. the request was retried or sent twice), reuse its id so
  // we UPDATE the same document in place instead of creating a duplicate. This
  // satisfies "update the same assistant message instead of creating a new one".
  let messageToSave: UIMessage = responseMessage
  if (userMessageId) {
    try {
      const existingId = await findExistingAssistantId(chatId, userMessageId)
      if (existingId && existingId !== responseMessage.id) {
        messageToSave = { ...responseMessage, id: existingId }
      }
    } catch (err) {
      console.error('findExistingAssistantId failed:', err)
    }
  }

  // Ensure the initial chat/message persistence finished before saving the response
  if (initialSavePromise) {
    const initialSaveStart = performance.now()
    try {
      await initialSavePromise
      perfTime('initial chat persistence awaited', initialSaveStart)
    } catch (error) {
      console.error('Initial chat persistence failed:', error)
      if (initialUserMessage) {
        const fallbackStart = performance.now()
        try {
          await createChatWithFirstMessage(
            chatId,
            initialUserMessage,
            userId,
            DEFAULT_CHAT_TITLE
          )
          perfTime('initial chat persistence fallback completed', fallbackStart)
        } catch (fallbackError) {
          // Check if the error is due to duplicate key (chat already exists)
          const isDuplicateKey =
            fallbackError instanceof Error &&
            (fallbackError.message.includes('duplicate key') ||
              fallbackError.message.includes('unique constraint'))

          if (isDuplicateKey) {
            // Chat already exists, this is fine - continue to save the response message
            console.log(
              'Chat already exists (duplicate key), continuing with response save'
            )
            perfTime(
              'initial chat persistence - duplicate detected',
              fallbackStart
            )
          } else {
            // Other error - log and return
            console.error('Fallback chat creation failed:', fallbackError)
            return
          }
        }
      } else {
        return
      }
    }
  }

  // Save message with retry logic
  const saveStart = performance.now()
  try {
    await upsertMessage(chatId, messageToSave, userId)
    perfTime('upsertMessage (AI response) completed', saveStart)
  } catch (error) {
    console.error('Error saving message:', error)
    try {
      await retryDatabaseOperation(
        () => upsertMessage(chatId, messageToSave, userId),
        'save message'
      )
      perfTime('upsertMessage (AI response) completed after retry', saveStart)
    } catch (retryError) {
      console.error('Failed to save after retries:', retryError)
      // Don't throw here to avoid breaking the stream
    }
  }
}

/**
 * Best-effort chat-title update. Runs in the BACKGROUND (it awaits an LLM
 * call) — never blocks stream close. Errors are swallowed by design.
 */
export async function persistChatTitle(
  chatId: string,
  userId: string,
  titlePromise?: Promise<string>
): Promise<void> {
  try {
    const chatTitle = titlePromise ? await titlePromise : undefined
    if (chatTitle && chatTitle !== DEFAULT_CHAT_TITLE) {
      await updateChatTitle(chatId, chatTitle, userId)
    }
  } catch (error) {
    console.error('Error updating title:', error)
  }
}
