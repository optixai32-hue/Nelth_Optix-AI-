import type { UIMessage } from 'ai'

import { getSkillRegistry } from './registry'
import { routeSkills } from './router'
import { foldText, intentRe } from './text-fold'

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
//
// ALL-LANGUAGE INTENTS: patterns below are written FOLDED (lowercase, no
// diacritics; non-Latin scripts as-is) and tested against foldText(query), so
// Spanish, German, Italian, Portuguese, Malagasy, Arabic, Chinese, Russian…
// route exactly like English/French. Unicode edges are used because \b never
// matches inside non-Latin text.
//
// Exported: the researcher imports these exact regexes so both layers agree.
export const IMAGE_INTENT_RE = intentRe(
  'image|photo|picture|draw|dessine|dessiner|illustr|generer\\s+(une\\s+)?image|create\\s+an?\\s+image|generate\\s+an?\\s+image|restyle|turn\\s+my\\s+photo|edit\\s+(this|my)\\s+(photo|image)|transform\\s+(this|my)\\s+(photo|image)' +
    '|crear\\s+imagen|crea\\s+(una\\s+)?imagen|generar\\s+imagen|dibujar|bild\\s+erstellen|bild\\s+generieren|crea\\s+immagine|disegna|criar\\s+imagem|cria\\s+(uma\\s+)?imagem|gerar\\s+imagem|mamorona\\s+sary' +
    '|انشاء\\s+صورة|انشئ\\s+صورة|ارسم|生成图片|创建图片|绘制图片|生成.{0,6}图片|创建.{0,6}图片|создать\\s+изображение|создай|нарисуй'
)
export const DOCUMENT_INTENT_RE = intentRe(
  'pdf|docx|xlsx|pptx|doc|xls|ppt|odt|csv|txt|md|document|documents|transcribe|facture|factures|invoice|invoices|rapport|rapports|report|reports|contrat|contrats|contract|contracts|cv|lettre|lettres|presentation|diapos|slides|diaporama|fichier|devis|recu|attestation|certificat|brochure|catalogue|menu|affiche|flyer|invitation|dissertation|these|memoire|formulaire|sondage|ebook|releve|bulletin' +
    '|factura|facturas|informe|informes|contrato|contratos|carta|cartas|archivo|archivos|documento|documentos|rechnung|rechnungen|bericht|berichte|vertrag|vertrage|brief|briefe|dokument|dokumente|datei|dateien|prasentation|prasentationen|folien|tabelle|tabellen|relazione|fattura|fatture|contratto|lettera|lettere|presentazione|relatorio|relatorios|fatura|faturas|arquivo|arquivos|apresentacao|taratasy' +
    '|فاتورة|فواتير|تقرير|تقارير|عقد|عقود|وثيقة|وثائق|مستند|مستندات|ملف|ملفات|عرض\\s+تقديمي|شرائح|جدول|发票|报告|合同|文档|文件|演示|幻灯片|表格|документ|документы|файл|файлы|договор|договоры|презентация|слайды|таблица|счет'
)
const CURRENT_INFO_RE = intentRe(
  'search|cherche[rsz]?|recherche[rsz]?|trouve[rsz]?|infos?|informations?|actualites?|news|prix|price|prices|meteo|weather|current|recent|recents?|recentes?|latest|dernier[es]*|dernieres?|hier|yesterday|today|aujourd.hui|demain|tomorrow|ce\\s+jour|ce\\s+matin|ce\\s+soir|cette\\s+semaine|ce\\s+mois|cette\\s+annee|en\\s+direct|live|score|match|resultats?|classement|gagnant|vainqueur|events?|evenements?|annonces?|announcements?|wwdc|2026|2025|2024' +
    '|president|presidents?|pr[eé]sident[es]?|premier\\s+ministre|prime\\s+minister|gouvernement|government|ministre|ministres|minister|ministers|election|elections?|[eé]lection[s]?|dirigeant|dirigeants|leader|leaders|chef\\s+d.etat|head\\s+of\\s+state|qui\\s+gouverne|qui\\s+dirige|qui\\s+commande|qui\\s+a\\s+gagn[eé]|qui\\s+est\\s+le|qui\\s+est\\s+la|qui\\s+sont|who\\s+is|who\\s+are|est-ce\\s+que|est-ce\\s+vrai|is\\s+it\\s+true|fact\\s*check|vrai\\s+ou\\s+faux|vrai\\s+que|verifie|verifies|verifier|check|actuel|actuelle|actuellement|currently|present|incumbent|pouvoir|madagascar' +
    // Questions seeking information / definitions / explanations
    '|qui\\s+est(?!\\s+tu\\b)|who\\s+is(?!\\s+you\\b)|c.est\\s+quoi|what\\s+is|c.est\\s+qui|who.s|qu.est[-\\s]ce\\s+qu|qu.est[-\\s]ce\\s+qui|qui\\s+a|qui\\s+a\\s+fait|qui\\s+a\\s+cree|qui\\s+a\\s+invente|quel\\s+est|quelle\\s+est|quels\\s+sont|quelles\\s+sont|what\\s+are|which\\s+is|where\\s+is|ou\\s+se\\s+trouve|ou\\s+est|comment\\s+fonctionne|how\\s+does|pourquoi|why\\s+is|combien\\s+coute|combien\\s+vaut|how\\s+much|how\\s+many' +
    // Releases, dates, technology, companies, models
    '|date\\s+de\\s+sortie|release\\s+date|sortie|sorti|sortira|disponible|disponibilite|version|modele|entreprise|societe|startup|compagnie|marque|intelligence\\s+artificielle|deepseek|chatgpt|openai|grok|claude|mistral|gemini|apple|google|microsoft|tesla|nvidia|starlink|spacex' +
    // Current affairs, geography, economics, politics
    '|championnat|ligue|tournoi|guerre|crise|politique|bourse|action|actions|crypto|bitcoin|inflation|taux|monnaie|population|superficie|capitale|maire|habitant|habitants' +
    // Weather asked the French way: "quel temps fait-il ?", "temps à Paris".
    // Bare "temps" alone is NOT matched (duration/cooking-time false
    // positives like "combien de temps", "temps de cuisson").
    '|quel\\s+temps|temps\\s+a|temps\\s+qu|temperature' +
    '|buscar|busca|busqueda|noticias?|precio|precios|hoy|ayer|quien\\s+es|suchen|sucht|suche|nachrichten|preis|heute|gestern|wer\\s+ist|cercare|cerca|notizie|notizia|prezzo|oggi|ieri|chi\\s+e|preco|hoje|ontem|quem\\s+e|mitady|vaovao|vidy|androany|omaly' +
    '|ابحث|بحث|أخبار|اخبار|سعر|اليوم|أمس|امس|من\\s+هو|搜索|新闻|价格|今天|昨天|是谁|искать|новости|цена|сегодня|вчера|кто\\s+такой'
)

const DOC_FORMATS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'ppt'])

const IDENTITY_QUERY_RE = intentRe(
  'qui\\s+(es|est|etes)[-\\s]?tu|tu\\s+(es|est)\\s+qui|t.es\\s+qui|qui\\s+t.es|qui\\s+etes[-\\s]?vous|vous\\s+etes\\s+qui' +
    '|who\\s+are\\s+you|what\\s+are\\s+you|who\\s+made\\s+you|who\\s+created\\s+you|what\\s+is\\s+your\\s+name|whats\\s+your\\s+name' +
    '|qui\\s+t.a\\s+(cree|concu|developpe|fait)|qui\\s+est\\s+ton\\s+createur|qui\\s+vous\\s+a\\s+cree' +
    '|presente[-\\s]?toi|presentez[-\\s]?vous|ton\\s+nom|votre\\s+nom|comment\\s+tu\\s+t.appelles|comment\\s+vous\\s+vous\\s+appelez' +
    '|c.est\\s+quoi\\s+nelth|qui\\s+est\\s+nelth|c.est\\s+quoi\\s+optix|qui\\s+est\\s+optix' +
    '|iza\\s+ianao|ianao\\s+iza|inona\\s+ianao|iza\\s+no\\s+namorona\\s+anao|ahoana\\s+ny\\s+anaranao|inona\\s+ny\\s+anaranao'
)

// Internal knowledge subjects (Nelcia, Yannick, Optix AI, Nelth AI, founders).
// These are part of core identity and must NEVER trigger external web search or generateImage.
const INTERNAL_KNOWLEDGE_SUBJECT_RE =
  /\b(nelcia|julie\s+fenitra|randrianavahana|yannick(?:\s+jonathan)?|todiarison|optix(?:\s*ai)?|nelth(?:\s*ai)?|(?:ceo|pdg|co-?founder|fondat(?:eur|rice|eurs)|cr[eé]at(?:eur|rice|eurs))\s+(?:d['’]|de\s+)?(?:optix|nelth))\b/i

// A request that wants to SEE the official photo of the CEO / Co-Founder /
// founders of Nelth-IA / Optix AI. These photos are provided directly in the
// system prompt, so the assistant must NOT search the web and MUST NOT call
// generateImage — it just renders the official markdown images.
const FOUNDER_PHOTO_INTENT_RE =
  /\b(photo|image|picture|portrait|visage|selfie|look|photos|images|pictures)\b/i
const FOUNDER_PHOTO_SUBJECT_RE =
  /\b(ceo|pdg|fondat(eur|rice|eurs)|cr[eé]at(eur|rice|eurs)|co-?founder|founder|dirigeant|nell?th|optix|yannick|jonathan|julie|fenitra|nelcia|randrianavahana|todiarison)\b/i

// Web IMAGE SEARCH vs IMAGE GENERATION (folded, all languages).
const WEB_SEARCH_VERB_RE = intentRe(
  'cherche|recherche|search|trouve|find|montre|show|voir|see|donne|give|regarde|look' +
    '|buscar|busca|suchen|sucht|cercare|cerca|procurar|procura|mitady|jereo|ابحث|اعرض|搜索|查找|искать|найти|покажи'
)
const IMAGE_NOUN_RE = intentRe(
  'image|photo|picture|illustration|photos|images|pictures' +
    '|imagen|imagenes|foto|fotos|bild|bilder|immagine|immagini|imagem|imagens|sary|صورة|صور|图片|照片|图像|изображение|фото|картинка'
)
const GEN_IMAGE_VERB_RE = intentRe(
  'genere|cree|create|draw|dessine|dessiner|generate|restyle|transforme|edit|make\\s+an?\\s+image|une\\s+image\\s+de|an\\s+image\\s+of' +
    '|crear\\s+imagen|crea\\s+una\\s+imagen|generar\\s+imagen|dibujar|bild\\s+erstellen|crea\\s+immagine|criar\\s+imagem|cria\\s+uma\\s+imagem|gerar\\s+imagem|mamorona\\s+sary' +
    '|انشاء\\s+صورة|ارسم|生成图片|创建图片|создать\\s+изображение'
)

function isWebImageSearch(q: string | undefined | null): boolean {
  if (!q) return false
  const qf = foldText(q)
  return (
    WEB_SEARCH_VERB_RE.test(qf) &&
    IMAGE_NOUN_RE.test(qf) &&
    !GEN_IMAGE_VERB_RE.test(qf)
  )
}

const FOLLOW_UP_PRONOUN_RE = intentRe(
  'leur|leurs|son|sa|ses|ca|ce|cet|cette|ces|eux|elle|elles|il|ils|lui|it|its|they|their|them|this|that|these|those|qui|quoi|ou|quand|comment|pourquoi|combien|et\\s+pour|et\\s+son|et\\s+sa|et\\s+ses|et\\s+le|et\\s+la|et\\s+les|continue|suite|approfondis|developpe|raconte|plus|davantage|d.autre'
)

function isConversationContinuation(
  query: string,
  history: UIMessage[] = []
): boolean {
  if (!query || history.length <= 1) return false
  const qf = foldText(query.trim())
  const words = qf.split(/\s+/)
  // Short questions (<= 6 words) or messages containing pronouns/follow-up markers
  const isFollowUpStructure = words.length <= 6 || FOLLOW_UP_PRONOUN_RE.test(qf)
  if (!isFollowUpStructure) return false

  // Check if any recent assistant message in history had citations or search results
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant) return false

  const hasSearchInLastAssistant = lastAssistant.parts.some(
    part =>
      part.type === 'tool-search' ||
      (part.type === 'text' && /\[\s*\d+\s*\]\(#|\[\d+\]/.test(part.text))
  )
  return hasSearchInLastAssistant
}

/**
 * Detect whether a request requires any skill or external tool.
 *
 * @param query             latest user message text
 * @param attachmentFormats  file types present on the message (e.g. 'pdf',
 *                            'image/png'); an uploaded document forces its skill.
 * @param history           full prior messages in the conversation (to preserve
 *                            search intent across follow-up turns).
 */
export async function detectRequestCapabilities(
  query: string,
  attachmentFormats: string[] = [],
  history: UIMessage[] = []
): Promise<RequestCapabilities> {
  const registry = await getSkillRegistry()
  const candidateSkillSlugs = registry.length
    ? routeSkills(query, registry).map(s => s.slug)
    : []

  // Folded once: every intent regex below is written folded (lowercase, no
  // diacritics) so all languages match identically.
  const qf = foldText(query ?? '')

  const isIdentity = IDENTITY_QUERY_RE.test(qf)
  const isInternalKnowledge =
    query !== undefined && query !== null
      ? INTERNAL_KNOWLEDGE_SUBJECT_RE.test(query) || isIdentity
      : false

  // Founder-photo request: present the official photos directly. Force
  // needsSearch/needsImage OFF so the orchestrator treats it as trivial (no
  // tools armed) and the model cannot run a web search or image generation.
  const founderPhoto =
    query !== undefined && query !== null
      ? FOUNDER_PHOTO_INTENT_RE.test(query) &&
        (FOUNDER_PHOTO_SUBJECT_RE.test(query) || isInternalKnowledge)
      : false

  // Web image search: route to the search tool (content_types: image), never
  // generateImage. Force needsImage OFF and needsSearch ON.
  const webImageSearch = !isInternalKnowledge && isWebImageSearch(query)

  const needsImage =
    (Boolean(query && IMAGE_INTENT_RE.test(qf)) ||
      attachmentFormats.some(f => f.startsWith('image/'))) &&
    !founderPhoto &&
    !webImageSearch &&
    !isInternalKnowledge

  const needsDocument =
    Boolean(query && DOCUMENT_INTENT_RE.test(qf)) ||
    attachmentFormats.some(f => DOC_FORMATS.has(f.toLowerCase()))

  const isFollowUp = isConversationContinuation(query, history)

  const needsSearch = query
    ? (CURRENT_INFO_RE.test(qf) || webImageSearch || isFollowUp) &&
      !founderPhoto &&
      !isInternalKnowledge
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
