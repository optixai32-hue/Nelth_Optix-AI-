import type { UIMessage } from 'ai'

import { getTextFromParts } from '@/lib/utils/message-utils'

export interface NormalizedConversation {
  messages: UIMessage[]
  /** Number of messages dropped as id/text duplicates. */
  droppedDuplicates: number
  /** Number of contentless messages dropped (never the last one). */
  droppedEmpties: number
}

function messageText(message: UIMessage): string {
  try {
    return getTextFromParts(message.parts).trim()
  } catch {
    return ''
  }
}

function hasUsableParts(message: UIMessage): boolean {
  const parts = (message as { parts?: unknown }).parts
  if (!Array.isArray(parts) || parts.length === 0) return false
  return parts.some(part => {
    if (!part || typeof part !== 'object') return false
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text') {
      return typeof p.text === 'string' && p.text.trim().length > 0
    }
    // Tool / file / data / reasoning parts carry meaning even without text.
    return typeof p.type === 'string' && p.type.length > 0
  })
}

function hasNonTextParts(message: UIMessage): boolean {
  const parts = (message as { parts?: unknown }).parts
  return (
    Array.isArray(parts) &&
    parts.some(
      part =>
        !!part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type !== 'text'
    )
  )
}

/**
 * Authoritative conversation normalization — the single place that guarantees
 * what the LLM receives as history:
 *
 * - the current user message exists EXACTLY ONCE (a stale/duplicate copy with
 *   the same id earlier in the list is dropped in favor of the last, freshest
 *   occurrence, e.g. with freshly signed file URLs),
 * - exact duplicate messages (same id, or same role + same text back to
 *   back from double-submits/retries/stream finalization) are removed,
 * - contentless messages are removed, EXCEPT the last one (never destroy the
 *   live request even if it looks empty),
 * - chronological order is otherwise preserved untouched: no merging, no
 *   rewording, no "Previous question:" rewriting — user → assistant → user.
 */
export function normalizeConversationHistory(
  messages: UIMessage[] | null | undefined
): NormalizedConversation {
  const list = Array.isArray(messages) ? messages : []
  if (list.length === 0) {
    return { messages: [], droppedDuplicates: 0, droppedEmpties: 0 }
  }

  let droppedDuplicates = 0
  let droppedEmpties = 0

  // Pass 1 — drop contentless messages, but never the last one.
  const nonEmpty = list.filter((message, index) => {
    const isLast = index === list.length - 1
    if (isLast) return true
    if (!message || typeof message !== 'object') {
      droppedEmpties++
      return false
    }
    if (!hasUsableParts(message as UIMessage)) {
      droppedEmpties++
      return false
    }
    return true
  })

  // Pass 2 — dedupe by id, keeping the LAST (freshest) occurrence.
  const seenIds = new Set<string>()
  const dedupedById: UIMessage[] = []
  for (let i = nonEmpty.length - 1; i >= 0; i--) {
    const message = nonEmpty[i]
    const id =
      message && typeof message === 'object'
        ? (message as { id?: unknown }).id
        : undefined
    if (typeof id === 'string' && id.length > 0) {
      if (seenIds.has(id)) {
        droppedDuplicates++
        continue
      }
      seenIds.add(id)
    }
    dedupedById.unshift(message)
  }

  // Pass 3 — drop consecutive exact duplicates (same role + same text),
  // keeping the first. Turns carrying tool/file/data parts are never merged:
  // identical prose with different tool payloads must both survive.
  const out: UIMessage[] = []
  for (const message of dedupedById) {
    const prev = out[out.length - 1]
    if (
      prev &&
      !hasNonTextParts(prev as UIMessage) &&
      !hasNonTextParts(message as UIMessage) &&
      (prev as { role?: unknown }).role ===
        (message as { role?: unknown }).role &&
      messageText(prev as UIMessage) !== '' &&
      messageText(prev as UIMessage) === messageText(message as UIMessage)
    ) {
      droppedDuplicates++
      continue
    }
    out.push(message)
  }

  return { messages: out, droppedDuplicates, droppedEmpties }
}
