/**
 * Some models (e.g. Nemotron) sometimes emit the related-questions / image
 * spec JSONL without wrapping it in a ```spec fenced block. When that happens
 * the JSON is rendered as raw text. This helper detects a bare run of JSONL
 * spec lines and wraps it in a ```spec fence so the renderer can pick it up.
 *
 * It only wraps content that looks like a real spec block: consecutive lines
 * that each start with `{"op":` and contain a `path` field, covering the
 * `{"op":"add","path":...}` shape used by related-question and image specs.
 *
 * Content inside fenced code blocks (``` ... ```) is NEVER touched: code
 * tutorials legitimately contain `{"op":...}` JSON that must stay prose.
 * Each bare run is wrapped independently — runs are never merged or moved.
 */
const SPEC_LINE_RE = /^\s*\{\s*"op"\s*:[^}]*"path"\s*:/

function looksLikeSpecLine(line: string): boolean {
  return SPEC_LINE_RE.test(line)
}

export function wrapBareSpecBlocks(text: string): string {
  if (!text.includes('{"op":')) return text

  const lines = text.split('\n')
  const out: string[] = []
  let buffer: string[] = []
  let inFence = false

  const flush = (fenced: boolean) => {
    if (buffer.length === 0) return
    if (fenced) {
      out.push('```spec')
      out.push(...buffer)
      out.push('```')
    } else {
      out.push(...buffer)
    }
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\s*```/.test(line)) {
      // A fence boundary ends any pending bare run; the fence itself and
      // everything inside fenced regions passes through untouched.
      flush(true)
      inFence = !inFence
      out.push(line)
      continue
    }
    // Some models emit a ```spec fence whose closing delimiter is malformed:
    // a bare `spec` line (no backticks) instead of ```. Repair it inside
    // fences; outside fences only a run in progress justifies touching it —
    // a lone prose "spec" word must never become a fence.
    // NOTE: this check must come BEFORE the in-fence passthrough below,
    // otherwise a malformed closer inside a fence would leak through.
    if (trimmed === 'spec') {
      if (inFence) {
        inFence = false
        out.push('```')
      } else if (buffer.length > 0) {
        flush(true)
      } else {
        out.push(line)
      }
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (looksLikeSpecLine(line)) {
      buffer.push(line)
    } else {
      // A non-spec line ends the run: wrap what we collected in place so
      // separate runs never merge and surrounding prose keeps its order.
      flush(true)
      out.push(line)
    }
  }
  // A run left open at the end of the message still gets wrapped.
  flush(true)

  return out.join('\n')
}
