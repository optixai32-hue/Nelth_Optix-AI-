import { UIMessage } from '@ai-sdk/react'

import { Model } from '../types/models'
import { SearchMode } from '../types/search'

export interface BaseStreamConfig {
  message: UIMessage | null
  model: Model
  chatId: string
  userId: string
  trigger?: 'submit-user-message' | 'regenerate-assistant-message'
  messageId?: string
  abortSignal?: AbortSignal
  isNewChat?: boolean
  searchMode?: SearchMode
  /**
   * Client-side message history (useChat state) as a continuity backstop.
   * The browser always has the freshest turns — including the previous
   * assistant message that may not be in Firestore yet when the user
   * replies quickly (DB save races the next request). The orchestrator
   * merges messages missing from the DB snapshot so connected chats see
   * the same history as guest chats. Optional; absent = DB only.
   */
  messages?: UIMessage[]
}
