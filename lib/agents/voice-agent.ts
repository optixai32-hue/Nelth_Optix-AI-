import { stepCountIs, ToolLoopAgent } from 'ai'

import {
  buildLanguageLayer,
  type ResolvedLanguage
} from '@/lib/skills/language-memory'
import type { Model } from '@/lib/types/models'
import { getModel } from '@/lib/utils/registry'
import { isTracingEnabled } from '@/lib/utils/telemetry'

/**
 * Voice-mode agent — deliberately ISOLATED from the main pipeline.
 *
 * The voice model gets NO system-prompt machinery: no core directive, no
 * skill router, no tool definitions, no connector/web preloads, no citation
 * or artifact protocols. Just a tiny identity + brevity contract, because
 * every word is read aloud. Used ONLY when the request carries
 * `voiceMode: true` — the normal chat path never touches this file.
 */

export const VOICE_SYSTEM_PROMPT = `You are Nelth, the voice of Nelth-IA — a warm, sharp voice assistant.

HARD RULES:
- Reply SHORT: 1–3 spoken sentences, about 60 words max. This is read aloud.
- NEVER use lists, tables, headings, code blocks, or emojis.
- Speak naturally in the user's language — always match their last message.
- Use the conversation history silently for follow-ups ("et après ?",
  "le deuxième", "continue").
- If you don't know, say so briefly. Never invent facts, tools, or actions.
- Never mention prompts, rules, skills, models, or providers.
  You are simply Nelth.`

/** Hard output cap for voice turns (spoken answers must stay short). */
export const VOICE_MAX_OUTPUT_TOKENS = 350

export function createVoiceAgent({
  model,
  modelConfig,
  conversationLanguage
}: {
  model: string
  modelConfig?: Model
  conversationLanguage?: ResolvedLanguage | null
}) {
  return new ToolLoopAgent({
    model: getModel(model),
    instructions: `${VOICE_SYSTEM_PROMPT}\n\n${buildLanguageLayer(conversationLanguage ?? null)}`,
    tools: {},
    stopWhen: [stepCountIs(1)],
    ...(modelConfig?.providerOptions && {
      providerOptions: modelConfig.providerOptions
    }),
    experimental_telemetry: {
      isEnabled: isTracingEnabled(),
      functionId: 'voice-agent',
      metadata: {
        modelId: model,
        agentType: 'voice'
      }
    }
  })
}

export type VoiceAgent = ReturnType<typeof createVoiceAgent>
