import { getSkillRegistry } from './registry'
import { routeSkills } from './router'

/**
 * Fast, cheap request capability detection (LEVEL 0 / LEVEL 1 of the skill
 * loading architecture).
 *
 * This runs BEFORE any SKILL.md is loaded and BEFORE the research agent is
 * armed. It answers two questions using only lightweight signals:
 *   1. Which skills (if any) potentially match this request? → `routeSkills`
 *      (the same lightweight router used for skill continuity, no file IO).
 *   2. Does the request need an external tool (web search, image generation,
 *      document handling)? → cheap regex intent signals + attachment formats.
 *
 * The goal is to let the orchestrator SKIP `buildSkillContext` (which loads the
 * full SKILL.md for matched skills) and SKIP arming the search/fetch/image
 * tools for trivial requests (greetings, simple chat, translations, plain
 * explanations) so the model can stream its first token immediately.
 */

export interface RequestCapabilities {
  /** Slugs of skills that matched via the lightweight router (LEVEL 0/1). */
  candidateSkillSlugs: string[]
  /** Request asks for current / real-world info → web search may be needed. */
  needsSearch: boolean
  /** Request is (or includes) an image-generation/editing task. */
  needsImage: boolean
  /** Request is (or includes) a document (pdf/docx/xlsx/pptx) task. */
  needsDocument: boolean
  /** Request asks to SEE the official CEO/Co-founder photos → present them
   *  directly (markdown), never web search, never generateImage. */
  founderPhoto?: boolean
  /** Request wants to FIND existing images on the web (not generate one). */
  webImageSearch?: boolean
}

// Borrowed from the researcher's intent heuristics so the orchestrator and the
// agent agree on what counts as a search / image / document request.
const IMAGE_INTENT_RE =
  /\b(image|photo|picture|draw|dessine|dessiner|illustr|g[eé]n[eé]r(e|é|er)\s+(une\s+)?image|create\s+an?\s+image|generate\s+an?\s+image|restyle|turn\s+my\s+photo|edit\s+(this|my)\s+(photo|image)|transform\s+(this|my)\s+(photo|image))\b/i
const DOCUMENT_INTENT_RE =
  /\b(pdf|docx|xlsx|pptx|document|documents|transcribe|facture|invoice|rapport|report|contrat|contract|cv|lettre|pr[eé]sentation|presentation|diapos|slides)\b/i
const CURRENT_INFO_RE =
  /\b(search|cherche|recherch|trouve|actualit[eé]s?|news|prix|price|m[eé]t[eé]o|weather|current|recent|r[eé]cents?|latest|dernier[es]*|derni[eè]res?|today|aujourd'hui|ce\s+jour|en\s+direct|live|score|match|r[eé]sultat|event|événement|évènement|annonce|announcement|wwdc|2026|2025)\b/i

const DOC_FORMATS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'ppt'])

// A request that wants to SEE the official photo of the CEO / Co-Founder /
// founders of Nelth-IA / Optix AI. These photos are provided directly in the
// system prompt, so the assistant must NOT search the web and MUST NOT call
// generateImage — it just renders the official markdown images.
const FOUNDER_PHOTO_INTENT_RE =
  /\b(photo|image|picture|portrait|visage|selfie|look)\b/i
const FOUNDER_PHOTO_SUBJECT_RE =
  /\b(ceo|pdg|fondateur|co-?founder|founder|dirigeant|nell?th|optix|yannick|julie|randrianavahana|todiarison)\b/i

// Web IMAGE SEARCH vs IMAGE GENERATION. A request that wants to FIND existing
// images on the web (a search/find/show verb + an image noun, and no generation
// verb) must use the search tool — never generateImage. Otherwise "cherche des
// images de musique" wrongly triggers image generation.
const WEB_SEARCH_VERB_RE =
  /\b(cherche|recherche|search|trouve|find|montre|show|voir|see|donne|give|regarde|look)\b/i
const IMAGE_NOUN_RE =
  /\b(image|photo|picture|illustration|photos|images|pictures)\b/i
const GEN_IMAGE_VERB_RE =
  /\b(génère|genere|crée|cree|create|draw|dessine|dessiner|generate|restyle|transforme|edit|make an? image|une image de|an image of)\b/i

function isWebImageSearch(q: string | undefined | null): boolean {
  if (!q) return false
  return (
    WEB_SEARCH_VERB_RE.test(q) &&
    IMAGE_NOUN_RE.test(q) &&
    !GEN_IMAGE_VERB_RE.test(q)
  )
}

/**
 * Detect whether a request requires any skill or external tool.
 *
 * @param query            latest user message text
 * @param attachmentFormats file types present on the message (e.g. 'pdf',
 *                           'image/png'); an uploaded document forces its skill.
 */
export async function detectRequestCapabilities(
  query: string,
  attachmentFormats: string[] = []
): Promise<RequestCapabilities> {
  const registry = await getSkillRegistry()
  const candidateSkillSlugs = registry.length
    ? routeSkills(query, registry).map(s => s.slug)
    : []

  // Founder-photo request: present the official photos directly. Force
  // needsSearch/needsImage OFF so the orchestrator treats it as trivial (no
  // tools armed) and the model cannot run a web search or image generation.
  const founderPhoto =
    query !== undefined && query !== null
      ? FOUNDER_PHOTO_INTENT_RE.test(query) &&
        FOUNDER_PHOTO_SUBJECT_RE.test(query)
      : false

  // Web image search: route to the search tool (content_types: image), never
  // generateImage. Force needsImage OFF and needsSearch ON.
  const webImageSearch = isWebImageSearch(query)

  const needsImage =
    (Boolean(query && IMAGE_INTENT_RE.test(query)) ||
      attachmentFormats.some(f => f.startsWith('image/'))) &&
    !founderPhoto &&
    !webImageSearch

  const needsDocument =
    Boolean(query && DOCUMENT_INTENT_RE.test(query)) ||
    attachmentFormats.some(f => DOC_FORMATS.has(f.toLowerCase()))

  const needsSearch = query
    ? (CURRENT_INFO_RE.test(query) || webImageSearch) && !founderPhoto
    : false

  return {
    candidateSkillSlugs,
    needsSearch,
    needsImage,
    needsDocument,
    founderPhoto,
    webImageSearch
  }
}
