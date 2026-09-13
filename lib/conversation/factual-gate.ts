/**
 * Fact-verification gate — Bug B (factual contradictions).
 *
 * A prompt rule ("don't contradict yourself") cannot guarantee factual
 * consistency: in the reported transcript the model quoted pricing/quota
 * figures from its weights, then contradicted them turn after turn. The only
 * robust fix is structural: whenever the user asks for verifiable,
 * time-sensitive facts — prices, quotas, limits, trials, versions — the
 * request MUST go through web search, even when the generic capability
 * detector sees no search intent (e.g. a short follow-up like "et les prix ?"
 * after an answer that was never searched).
 *
 * Pipeline enforced by the orchestrators:
 *   USER REQUEST → needsFactVerification() → WEB SEARCH (preload or tool)
 *   → SERVER-PROVIDED RESULTS → answer FROM the results, which are the
 *   source of truth and override any earlier thread answer.
 *
 * Deterministic and dependency-free (no extra LLM call, no latency beyond
 * the search itself, which the answer requires anyway).
 */

function foldQuery(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’‛′`]/g, "'")
}

/**
 * Money / pricing / cost — the exact failure class of the Azure transcript
 * ("5h/mois" → "5000 caractères" → "30 min"). Folded (no diacritics), FR/EN.
 */
const PRICING_RE =
  /\b(prix|price|prices|pricing|tarif|tarifs|cout|coute|coutent|couter|combien|how\s*much|payant|payer|paiement|payment|facturation|billing|abonnement|subscription|forfait|gratuit|gratis|free\b|cout\s*par|par\s*mois|per\s*month)\b/

/** Quotas, caps, usage limits — "free no limit", "heures/mois", "caractères". */
const QUOTA_RE =
  /\b(quota|plafond|rate\s*limit|free\s*tier|utilisation|usage|heures?\s*\/\s*mois|per\s*month|mensuel|journalier|caracteres?|tokens?)\b|((la|une|des|les|ces)\s+limites?|limites?\s+(de|du|des|mensuelle?|par|journaliere?|quotidienne|d'))/

/** Trials and plans — time-sensitive commercial facts. */
const TRIAL_RE =
  /\b(trial|trials|essai|pilot|beta|plan\s+(gratuit|payant|pro|plus|team|business|entreprise)|offre\s+(gratuite|d'essai)|version\s+d'essai)\b/

/** Versions and releases — must be checked, never recalled. */
const VERSION_RE =
  /\b(derniere|latest|nouvelle|mise\s*a\s*jour|update|upgrade|release|date\s*de\s*sortie|sortie\s+(de|du|des)|sorti(e)?s?\b|sortira|changelog|version\s+(de|du|des|actuelle|stable|en\s*cours))\b|\bv\d+(\.\d+)*/i

/** Internal knowledge that must NEVER be web-searched (identity safety). */
const INTERNAL_RE =
  /\b(nelth|optix|nelcia|yannick|qui\s+es[- ]?tu|who\s+are\s+you|ton\s+nom|your\s+name)\b/

/**
 * True when the query asks for verifiable, time-sensitive facts that must be
 * answered from fresh web results — never from weights, and never by quoting
 * an earlier thread answer. Pure greetings, creative writing, code help and
 * math never match.
 */
export function needsFactVerification(query: string): boolean {
  const q = foldQuery(query).trim()
  if (!q) return false
  if (INTERNAL_RE.test(q)) return false
  return (
    PRICING_RE.test(q) ||
    QUOTA_RE.test(q) ||
    TRIAL_RE.test(q) ||
    VERSION_RE.test(q)
  )
}
