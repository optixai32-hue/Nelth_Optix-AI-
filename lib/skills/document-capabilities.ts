import { capabilities as docxCaps } from './document-renderers/docx/renderer'
import { capabilities as htmlCaps } from './document-renderers/html/renderer'
import { capabilities as markdownCaps } from './document-renderers/markdown/renderer'
import { capabilities as pdfCaps } from './document-renderers/pdf/renderer'
import { capabilities as pptxCaps } from './document-renderers/pptx/renderer'
import { capabilities as svgCaps } from './document-renderers/svg/renderer'
import { capabilities as xlsxCaps } from './document-renderers/xlsx/renderer'

/**
 * Capability declaration for a single DocumentAST v1 renderer.
 *
 * These flags describe WHAT a target format can represent from the frozen AST
 * block set — not HOW. They let the runtime and the golden compatibility test
 * adapt to each format's real contract (e.g. PDF does not yet embed images or
 * propagate page breaks through the markdown→legacy adapter) without per-format
 * branching in the core or hand-written exception lists in the tests.
 */
export interface RendererCapabilities {
  /** `heading` block is represented. */
  supportsHeadings: boolean
  /** `paragraph` block is represented. */
  supportsParagraphs: boolean
  /** `list` block (bullet + ordered) is represented. */
  supportsLists: boolean
  /** `table` block is represented. */
  supportsTables: boolean
  /** `quote` block is represented. */
  supportsQuotes: boolean
  /** `code` block is represented. */
  supportsCode: boolean
  /** `image` block is embedded in the artifact. */
  supportsImages: boolean
  /** `pageBreak` block produces a real format-specific break. */
  supportsPageBreak: boolean
  /** Spatial format (slides) — content flows across pages/slides. */
  isSpatial?: boolean
  /** Tabular/spreadsheet format — content is laid out as rows/cells. */
  isSpreadsheet?: boolean
  /** Vector/graphics format. */
  isVector?: boolean
}

/**
 * Renderer capability registry.
 *
 * Each renderer declares, in ONE place, what the DocumentAST v1 blocks it can
 * actually represent. The runtime and the golden test read these declarations
 * instead of hardcoding per-format behavior — so adding a renderer (or a format
 * gaining/losing a capability) never requires touching the engine's branching
 * logic or the test's exception list.
 *
 * This is intentionally DATA, not behavior: it does not change how any renderer
 * works, only what the rest of the system knows about them.
 */
export const RENDERER_CAPABILITIES: Record<string, RendererCapabilities> = {
  pdf: pdfCaps,
  markdown: markdownCaps,
  html: htmlCaps,
  docx: docxCaps,
  pptx: pptxCaps,
  xlsx: xlsxCaps,
  svg: svgCaps
}

export function getCapabilities(
  format: string
): RendererCapabilities | undefined {
  return RENDERER_CAPABILITIES[format]
}

/** True when a dedicated AST renderer exists for the format (i.e. it is AST-native). */
export function hasRenderer(format: string): boolean {
  return format in RENDERER_CAPABILITIES
}
