/**
 * Silent-empty-response guard.
 *
 * When the weak model answers with ONLY fake `<tool_call>` XML, the
 * sanitizer strips all of it and the turn completes with zero text and zero
 * error — the client renders a blank bubble with no Retry affordance
 * (ChatError only shows when an error object exists). This helper decides
 * when to inject an honest, localized fallback line instead, so "no answer"
 * is always explainable and retryable. Exported for unit testing.
 */
export function shouldInjectEmptyFallback(args: {
  wroteContent: boolean
  wroteToolPart: boolean
  aborted: boolean
}): boolean {
  return !args.aborted && !args.wroteContent && !args.wroteToolPart
}

export function emptyResponseText(lang: string | null | undefined): string {
  return lang === 'en'
    ? 'Sorry, I could not generate a response. Please try again.'
    : 'Désolé, je n’ai pas pu générer de réponse. Veuillez réessayer.'
}
