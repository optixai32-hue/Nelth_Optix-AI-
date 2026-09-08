/**
 * Visual Intent Classifier.
 *
 * Decides, BEFORE any artifact/visual is generated, whether a visualization
 * actually adds value. This prevents the assistant from emitting a diagram /
 * chart / mind-map on every response (the "everything is a visual" problem).
 *
 * Output:
 *   - 'required'     → generate a visual (explicit request, or a clearly useful
 *                      complex / data / comparison / planning subject)
 *   - 'recommended' → generate a visual (strong signal it would help)
 *   - 'not_needed'  → answer in TEXT only (chat, explanation, translation,
 *                      summary, simple code, short conversational)
 *
 * Confidence score (0..1) follows the spec:
 *   < 0.60 → text only
 *   0.60–0.80 → text + visual only when genuinely useful
 *   > 0.80 → visualization recommended
 * An explicit user request is always 'required' (score 0.9+).
 *
 * Note: the model is also told this rule in the CORE_DIRECTIVE, but the
 * classifier is the DETERMINISTIC gate — `detectArtifactIntent` only treats a
 * request as a code/visual artifact when this returns something other than
 * 'not_needed'. Weak models that ignore the prompt therefore still cannot
 * force a visualization where it adds no value.
 */

const VISUAL_TERMS = [
  // Ideas / Knowledge
  'mind\\s*map',
  'concept\\s*map',
  'idea\\s*map',
  'knowledge\\s*map',
  'knowledge\\s*graph',
  'semantic\\s*map',
  'taxonomy',
  'ontology',
  'affinity\\s*diagram',
  'cluster\\s*diagram',
  'brainstorm\\s*map',
  'radial\\s*map',
  'sunburst',
  'hierarchy\\s*tree',
  'dendrogram',
  // Process / Workflow
  'flowchart',
  'workflow',
  'process\\s*diagram',
  'decision\\s*tree',
  'decision\\s*flow',
  'swimlane\\s*diagram',
  'bpmn',
  'sequence\\s*diagram',
  'state\\s*diagram',
  'activity\\s*diagram',
  'event\\s*diagram',
  'cause\\s*and\\s*effect',
  'fishbone',
  'ishikawa',
  'cycle\\s*diagram',
  'step\\s*diagram',
  'lifecycle\\s*diagram',
  'funnel\\s*diagram',
  // Software / Engineering
  'system\\s*architecture',
  'software\\s*architecture',
  'component\\s*diagram',
  'class\\s*diagram',
  'object\\s*diagram',
  'package\\s*diagram',
  'deployment\\s*diagram',
  'use\\s*case\\s*diagram',
  'communication\\s*diagram',
  'state\\s*machine',
  'er\\s*diagram',
  'database\\s*schema',
  'data\\s*flow\\s*diagram',
  'api\\s*architecture',
  'microservices\\s*diagram',
  'infrastructure\\s*diagram',
  'cloud\\s*architecture',
  'network\\s*diagram',
  'network\\s*topology',
  'dependency\\s*graph',
  'cicd\\s*pipeline',
  'git\\s*branch\\s*diagram',
  // Charts / Data Visualization
  'bar\\s*chart',
  'column\\s*chart',
  'line\\s*chart',
  'area\\s*chart',
  'pie\\s*chart',
  'donut\\s*chart',
  'stacked\\s*bar',
  'grouped\\s*bar',
  'histogram',
  'scatter\\s*plot',
  'bubble\\s*chart',
  'radar\\s*chart',
  'heatmap',
  'treemap',
  'sunburst\\s*chart',
  'waterfall\\s*chart',
  'funnel\\s*chart',
  'gauge\\s*chart',
  'bullet\\s*chart',
  'box\\s*plot',
  'violin\\s*plot',
  'dot\\s*plot',
  'lollipop\\s*chart',
  'pareto\\s*chart',
  'candlestick\\s*chart',
  'streamgraph',
  'ridgeline\\s*plot',
  'area\\s*stream',
  'polar\\s*chart',
  'polar\\s*area\\s*chart',
  'choropleth\\s*map',
  'hexbin\\s*plot',
  'sankey\\s*diagram',
  'chord\\s*diagram',
  'parallel\\s*coordinates',
  'network\\s*graph',
  // Maps / Geography
  'geographic\\s*map',
  'interactive\\s*map',
  'choropleth',
  'bubble\\s*map',
  'heat\\s*map',
  'route\\s*map',
  'journey\\s*map',
  'location\\s*map',
  'territory\\s*map',
  'flow\\s*map',
  'cartogram',
  'story\\s*map',
  // Planning / Project
  'roadmap',
  'timeline',
  'gantt\\s*chart',
  'kanban\\s*board',
  'calendar',
  'milestone\\s*chart',
  'project\\s*dependency\\s*graph',
  'pert\\s*chart',
  'critical\\s*path',
  'work\\s*breakdown',
  'sprint\\s*board',
  'release\\s*plan',
  'product\\s*roadmap',
  // Business / Strategy
  'organizational\\s*chart',
  'business\\s*model\\s*canvas',
  'swot\\s*matrix',
  'strategy\\s*map',
  'customer\\s*journey\\s*map',
  'stakeholder\\s*map',
  'value\\s*chain',
  'value\\s*proposition\\s*canvas',
  'sales\\s*funnel',
  'marketing\\s*funnel',
  'conversion\\s*funnel',
  'growth\\s*matrix',
  'bcg\\s*matrix',
  'ansoff\\s*matrix',
  'raci\\s*matrix',
  'risk\\s*matrix',
  'impact\\s*matrix',
  'decision\\s*matrix',
  'prioritization\\s*matrix',
  'stakeholder\\s*grid',
  // Education
  'learning\\s*map',
  'study\\s*map',
  'course\\s*map',
  'curriculum\\s*tree',
  'learning\\s*path',
  'knowledge\\s*tree',
  'concept\\s*diagram',
  'comparison\\s*diagram',
  'sequence\\s*map',
  'cause\\s*effect\\s*map',
  'summary\\s*map',
  'cheat\\s*sheet',
  'visual\\s*notes',
  'lesson\\s*map',
  // Science / Mathematics
  'scientific\\s*diagram',
  'scientific\\s*schematic',
  'anatomy\\s*diagram',
  'biological\\s*diagram',
  'cell\\s*diagram',
  'ecosystem\\s*diagram',
  'food\\s*web',
  'food\\s*chain',
  'molecular\\s*diagram',
  'chemical\\s*structure',
  'reaction\\s*diagram',
  'physics\\s*diagram',
  'circuit\\s*diagram',
  'geometry\\s*diagram',
  'mathematical\\s*graph',
  'coordinate\\s*graph',
  'function\\s*graph',
  'vector\\s*diagram',
  'venn\\s*diagram',
  'euler\\s*diagram',
  'set\\s*diagram',
  // General Diagrams
  'pyramid\\s*diagram',
  'layer\\s*diagram',
  'circular\\s*diagram',
  'radial\\s*diagram',
  'target\\s*diagram',
  'bullseye\\s*diagram',
  'staircase\\s*diagram',
  'ladder\\s*diagram',
  'bridge\\s*diagram',
  'funnel',
  'nested\\s*diagram',
  'onion\\s*diagram',
  'concentric\\s*circles',
  'continuum\\s*diagram',
  'spectrum\\s*diagram',
  'balance\\s*diagram',
  'scale\\s*diagram',
  'matrix\\s*diagram',
  'comparison\\s*diagram',
  'relationship\\s*diagram',
  'venn\\s*diagram',
  'overlap\\s*diagram',
  'before\\s*after\\s*diagram',
  'input\\s*output\\s*diagram',
  'black\\s*box\\s*diagram',
  'feedback\\s*loop',
  'feedback\\s*diagram',
  'ecosystem\\s*map',
  'graphique',
  'graphe',
  'diagramme',
  // UI / Product
  'wireframe',
  'user\\s*flow',
  'user\\s*journey',
  'screen\\s*flow',
  'navigation\\s*map',
  'sitemap',
  'information\\s*architecture',
  'ui\\s*architecture',
  'component\\s*map',
  'design\\s*system\\s*map',
  'feature\\s*map',
  'product\\s*feature\\s*matrix',
  'prototype\\s*flow',
  // Information / Presentation
  'infographic',
  'information\\s*poster',
  'visual\\s*report',
  'visual\\s*summary',
  'visual\\s*documentation',
  'fact\\s*sheet',
  'comparison\\s*card',
  'kpi\\s*dashboard',
  'executive\\s*dashboard',
  'scorecard',
  'profile\\s*card',
  'data\\s*story',
  'storyboard',
  'presentation\\s*diagram',
  // Advanced Graphs
  'graph\\s*network',
  'social\\s*graph',
  'entity\\s*graph',
  'relationship\\s*graph',
  'dependency\\s*graph',
  'citation\\s*graph',
  'knowledge\\s*graph',
  'semantic\\s*network',
  'bipartite\\s*graph',
  'directed\\s*graph',
  'undirected\\s*graph',
  'tree\\s*graph',
  'cluster\\s*graph',
  'hierarchical\\s*graph',
  'influence\\s*graph',
  'causal\\s*graph',
  'conceptual\\s*graph',
  // AI / Data Science
  'ml\\s*pipeline',
  'ai\\s*architecture',
  'neural\\s*network\\s*diagram',
  'model\\s*architecture',
  'transformer\\s*architecture',
  'data\\s*pipeline',
  'etl\\s*pipeline',
  'rag\\s*architecture',
  'agent\\s*architecture',
  'multi\\s*agent\\s*diagram',
  'tool\\s*calling\\s*flow',
  'prompt\\s*flow',
  'ai\\s*workflow',
  'inference\\s*pipeline',
  'training\\s*pipeline',
  'evaluation\\s*pipeline',
  'dataset\\s*relationship\\s*map',
  'embedding\\s*visualization',
  'confusion\\s*matrix',
  'roc\\s*curve',
  'precision\\s*recall\\s*curve',
  'feature\\s*importance\\s*chart',
  'decision\\s*boundary',
  // Architecture / Infrastructure
  'physical\\s*architecture',
  'logical\\s*architecture',
  'application\\s*architecture',
  'data\\s*architecture',
  'security\\s*architecture',
  'enterprise\\s*architecture',
  'solution\\s*architecture',
  'infrastructure\\s*architecture',
  'server\\s*architecture',
  'kubernetes\\s*architecture',
  'container\\s*architecture',
  'distributed\\s*system\\s*diagram',
  'database\\s*architecture',
  'storage\\s*architecture',
  'authentication\\s*flow',
  'authorization\\s*flow',
  'security\\s*threat\\s*model',
  // Finance / Analytics
  'financial\\s*dashboard',
  'cash\\s*flow\\s*diagram',
  'income\\s*statement\\s*visualization',
  'balance\\s*sheet\\s*visualization',
  'portfolio\\s*chart',
  'allocation\\s*chart',
  'risk\\s*return\\s*matrix',
  'break\\s*even\\s*chart',
  'roi\\s*chart',
  'revenue\\s*chart',
  'expense\\s*chart',
  'budget\\s*chart',
  'financial\\s*waterfall',
  'kpi\\s*tree',
  'unit\\s*economics\\s*diagram'
]

const CREATION_VERBS = [
  'cree',
  'creer',
  'creez',
  'create',
  'make',
  'build',
  'generate',
  'genere',
  'fais',
  'fait',
  'draw',
  'dessine',
  'dessin',
  'montre',
  'show',
  'produis',
  'trace',
  'diagram',
  'schema',
  'visualise',
  'visualize',
  'represent',
  'plan',
  'planifie',
  'redige',
  'rediger',
  'ecrire',
  'write',
  'code',
  'develop',
  'dev',
  'implement',
  'realise',
  'realiser'
]

const BUILD_NOUNS = [
  'landing\\s*page',
  'page\\s*web',
  'website',
  'site\\s*web',
  'web\\s*app',
  'webapp',
  'application',
  'app',
  'dashboard',
  'ui',
  'interface',
  'composant',
  'component',
  'html',
  'css',
  'react',
  'frontend',
  'maquette',
  'prototype',
  'svg',
  'page',
  'mockup',
  'site'
]

const SIGNAL_TERMS = [
  'architecture',
  'workflow',
  'processus',
  'process',
  'dependances',
  'dependance',
  'hierarchie',
  'hierarchy',
  'systeme',
  'system',
  'relations',
  'relation',
  'branches',
  'branche',
  'complexe',
  'comparaison',
  'compare',
  'versus',
  'vs',
  'avantages',
  'inconvenients',
  'criteres',
  'criteria',
  'statistiques',
  'statistique',
  'evolution',
  'tendances',
  'tendance',
  'repartition',
  'donnees',
  'data',
  'roadmap',
  'planning',
  'milestone',
  'etapes',
  'projet',
  'gantt',
  'timeline',
  'arbre',
  'tree'
]

const NON_VISUAL_TERMS = [
  'bonjour',
  'hello',
  'salut',
  'bonsoir',
  'traduis',
  'traduire',
  'translate',
  'resume',
  'resumer',
  'summary',
  'questce\\s*que',
  'cest\\s*quoi',
  'comment\\s*fonctionne',
  'how\\s*does',
  'donne\\s*moi\\s*une\\s*fonction',
  'ecris\\s*une\\s*fonction',
  'write\\s*a\\s*function'
]

function buildRe(terms: string[]): RegExp {
  return new RegExp('\\b(?:' + terms.join('|') + ')\\b', 'i')
}

const VISUAL_RE = buildRe(VISUAL_TERMS)
const CREATION_VERB_RE = buildRe(CREATION_VERBS)
const BUILD_NOUN_RE = buildRe(BUILD_NOUNS)
const SIGNAL_RE = buildRe(SIGNAL_TERMS)
const NON_VISUAL_RE = buildRe(NON_VISUAL_TERMS)

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export type VisualIntent = 'required' | 'recommended' | 'not_needed'

export interface VisualIntentResult {
  intent: VisualIntent
  /** 0..1 confidence. >0.80 recommended, 0.60–0.80 useful, <0.60 text only. */
  score: number
  reason: string
}

/**
 * Classify whether a user message should produce a visualization.
 * Pure / deterministic — no model call.
 */
export function classifyVisualIntent(text: string): VisualIntentResult {
  const t = normalize(text ?? '')

  // 1) Explicit "do NOT visualize" intents win outright.
  if (NON_VISUAL_RE.test(t)) {
    return {
      intent: 'not_needed',
      score: 0.1,
      reason:
        'non-visual intent (greeting / translation / summary / simple code / explanatory question)'
    }
  }

  const hasVisual = VISUAL_RE.test(t)
  const hasCreationVerb = CREATION_VERB_RE.test(t)
  const hasBuildNoun = BUILD_NOUN_RE.test(t)
  const hasSignal = SIGNAL_RE.test(t)

  // 2) Explicit request: a creation verb + (a visual term, a build noun, OR a
  //    complex subject signal such as architecture / process / workflow).
  if (hasCreationVerb && (hasVisual || hasBuildNoun || hasSignal)) {
    return {
      intent: 'required',
      score: 0.92,
      reason: 'explicit creation request for a visual / app / UI artifact'
    }
  }

  // 3) A named visualization type was mentioned (even without a verb).
  if (hasVisual) {
    return {
      intent: 'recommended',
      score: 0.72,
      reason: 'a visualization type was named — generate it'
    }
  }

  // 4) Strong signal that a visual would clearly help comprehension.
  if (hasSignal) {
    return {
      intent: 'recommended',
      score: 0.66,
      reason:
        'complex / data / comparison / planning subject — visual recommended'
    }
  }

  // 5) Nothing indicates a visual adds value → text only.
  return {
    intent: 'not_needed',
    score: 0.2,
    reason: 'no visual intent detected — answer in text'
  }
}
