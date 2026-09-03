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
  'search|cherche[rsz]?|recherche[rsz]?|trouve[rsz]?|infos?|informations?|actualites?|news|prix|price|prices|meteo|weather|current|recent|recents?|recentes?|latest|dernier[es]*|dernieres?|hier|yesterday|today|aujourd.hui|demain|tomorrow|ce\\s+jour|ce\\s+matin|ce\\s+soir|cette\\s+semaine|ce\\s+mois|cette\\s+annee|en\\s+direct|live|score|match|resultats?|classement|gagnant|vainqueur|events?|evenements?|annonces?|announcements?|wwdc|qui\\s+est|who\\s+is|c.est\\s+quoi|what\\s+is|qu.est[-\\s]ce\\s+qui|2026|2025|2024' +
    '|buscar|busca|busqueda|noticias?|precio|precios|hoy|ayer|quien\\s+es|suchen|sucht|suche|nachrichten|preis|heute|gestern|wer\\s+ist|cercare|cerca|notizie|notizia|prezzo|oggi|ieri|chi\\s+e|preco|hoje|ontem|quem\\s+e|mitady|vaovao|vidy|androany|omaly' +
    '|ابحث|بحث|أخبار|اخبار|سعر|اليوم|أمس|امس|من\\s+هو|搜索|新闻|价格|今天|昨天|是谁|искать|новости|цена|сегодня|вчера|кто\\s+такой'
)

const DOC_FORMATS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'ppt'])

// Internal knowledge subjects (Nelcia, Yannick, Optix AI, Nelth AI, founders).
// These are part of core identity and must NEVER trigger external web search or generateImage.
const INTERNAL_KNOWLEDGE_SUBJECT_RE =
  /\b(nelcia|julie|fenitra|randrianavahana|yannick|jonathan|todiarison|optix|nelth|ceo|pdg|co-?founder|co-?fondat(eur|rice|eurs)|fondat(eur|rice|eurs)|cr[eé]at(eur|rice|eurs)|dirigeant)\b/i

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

  // Folded once: every intent regex below is written folded (lowercase, no
  // diacritics) so all languages match identically.
  const qf = foldText(query ?? '')

  const isInternalKnowledge =
    query !== undefined && query !== null
      ? INTERNAL_KNOWLEDGE_SUBJECT_RE.test(query)
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

  const needsSearch = query
    ? (CURRENT_INFO_RE.test(qf) || webImageSearch) &&
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
