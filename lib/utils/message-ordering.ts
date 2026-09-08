// Deterministic ordering for chat messages.
//
// The database is the source of truth for message ordering. The primary key is
// `sequence` — a server/database-assigned, monotonic integer per conversation.
// Legacy messages that predate the `sequence` field fall back to `createdAt`,
// and a final stable tiebreak uses the message id so the order is fully
// deterministic (never reliant on array/index position or insertion order).

export interface OrderableMessage {
  id: string
  sequence?: number | null
  createdAt?: Date | string | number | null
}

function toEpoch(value: unknown): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const t = new Date(value).getTime()
    return isNaN(t) ? 0 : t
  }
  if (
    typeof value === 'object' &&
    'toDate' in (value as any) &&
    typeof (value as any).toDate === 'function'
  ) {
    const d = (value as any).toDate()
    return d instanceof Date ? d.getTime() : 0
  }
  return 0
}

/**
 * Compare two messages for deterministic ordering.
 * 1. Both have a sequence → compare sequence ASC.
 * 2. Otherwise → compare createdAt ASC.
 * 3. Otherwise → stable compare by id.
 */
export function compareMessagesForOrder(
  a: OrderableMessage,
  b: OrderableMessage
): number {
  const sa = a.sequence ?? null
  const sb = b.sequence ?? null

  if (sa != null && sb != null && sa !== sb) {
    return sa - sb
  }

  const ta = toEpoch(a.createdAt)
  const tb = toEpoch(b.createdAt)
  if (ta !== tb) return ta - tb

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Enforce the canonical chat shape: exactly one assistant reply per user turn,
 * i.e. no two consecutive messages may share the same role. Consecutive
 * same-role messages are always artifacts of the persistence bug (retried or
 * double-submitted requests), so we keep the FIRST message of each same-role
 * run and drop the rest. This guarantees the hydrated UI renders a clean
 * USER → AI → USER → AI sequence regardless of how the data was corrupted.
 */
export function dedupeConsecutiveDuplicates<
  T extends OrderableMessage & { role?: string }
>(messages: T[]): T[] {
  const result: T[] = []
  for (const message of messages) {
    const prev = result[result.length - 1]
    if (prev && prev.role === message.role) continue
    result.push(message)
  }
  return result
}

/** Return a new array sorted by deterministic message order. */
export function sortMessagesForOrder<T extends OrderableMessage>(
  messages: T[]
): T[] {
  return [...messages].sort(compareMessagesForOrder)
}
