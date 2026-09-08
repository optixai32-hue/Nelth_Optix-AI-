// Splits a model text chunk into its reasoning (thinking) portion and the
// final answer. Some OpenAI-compatible providers (e.g. NVIDIA Nemotron) emit
// their reasoning inside <think>...</think> blocks within the normal text
// stream instead of a dedicated reasoning part. We extract that block so the
// UI can treat it as collapsible reasoning and keep it out of the answer.
//
// Some models also emit the related-questions / image ```spec block inside the
// <think> section (or forget to place it after the answer). To avoid dropping
// those generated UI blocks, any spec JSONL found inside a thinking block is
// kept on the answer side rather than hidden with the reasoning.

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'
const SPEC_LINE_RE = /^\s*\{\s*"op"\s*:/

export type SplitThinkingResult = {
  /** Reasoning text extracted from <think> blocks, without the tags. */
  reasoning: string
  /** The remaining text that forms the actual answer. */
  answer: string
}

/**
 * Separates a single <think> segment's content into reasoning (to hide) and any
 * spec JSONL (to keep, since it drives the rendered Related/Image UI).
 */
function splitSpecFromReasoning(segment: string): {
  reasoning: string
  spec: string
} {
  const lines = segment.split('\n')
  const reasoningLines: string[] = []
  const specLines: string[] = []

  for (const line of lines) {
    if (SPEC_LINE_RE.test(line.trim())) {
      specLines.push(line)
    } else {
      reasoningLines.push(line)
    }
  }

  return {
    reasoning: reasoningLines.join('\n'),
    spec: specLines.join('\n')
  }
}

/**
 * Extracts <think> blocks from `text`. Everything between `<think>` and the
 * last `</think>` is treated as reasoning; the rest is the answer.
 *
 * An unclosed `<think>` is always treated as the answer (never hidden), so a
 * reasoning block the model forgot to close can never swallow the final
 * response. The answer is what the user came for; a missing collapse panel is
 * a far smaller loss than a truncated reply.
 *
 * Any spec JSONL (lines starting with `{"op":`) found inside a thinking block
 * is preserved on the answer side, so generated Related/Image UI is never
 * hidden by the reasoning collapse.
 */
export function splitThinking(text: string): SplitThinkingResult {
  if (!text.includes(THINK_OPEN)) {
    return { reasoning: '', answer: text }
  }

  const segments = text.split(THINK_OPEN)
  let reasoning = ''
  let answer = segments[0] ?? ''

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]
    const closeIndex = segment.indexOf(THINK_CLOSE)

    if (closeIndex === -1) {
      // No closing tag: always treat the remainder as the answer so an
      // unterminated thinking block can never hide the response. Spec lines
      // inside are still preserved as answer.
      const { reasoning: r, spec } = splitSpecFromReasoning(segment)
      if (spec) answer += `\n${spec}\n`
      answer += r
      continue
    }

    const inner = segment.slice(0, closeIndex)
    const { reasoning: r, spec } = splitSpecFromReasoning(inner)
    reasoning += (reasoning && !reasoning.endsWith('\n') ? '\n' : '') + r
    if (spec) answer += `\n${spec}\n`
    answer += segment.slice(closeIndex + THINK_CLOSE.length)
  }

  return { reasoning, answer }
}

/**
 * Removes any <think>...</think> blocks from a text string, returning only the
 * answer portion. Used to keep reasoning out of the rendered response.
 */
export function stripThinking(text: string): string {
  if (!text.includes(THINK_OPEN)) return text
  return text
    .split(THINK_OPEN)
    .map(chunk => {
      const closeIndex = chunk.indexOf(THINK_CLOSE)
      return closeIndex === -1
        ? chunk
        : chunk.slice(closeIndex + THINK_CLOSE.length)
    })
    .join('')
}
