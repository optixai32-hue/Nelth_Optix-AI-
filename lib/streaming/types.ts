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
   * Voice-mode turns: bypass the whole research pipeline (long system
   * prompt, skills, tools, preloads) and answer from a tiny voice-only
   * system prompt with a hard token cap. Normal turns never set this.
   */
  voiceMode?: boolean
}
