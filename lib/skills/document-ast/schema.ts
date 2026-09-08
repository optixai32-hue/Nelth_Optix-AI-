import { z } from 'zod'

export const headingSchema = z.object({
  type: z.literal('heading'),
  level: z.number().int().min(1).max(6),
  text: z.string()
})

export const paragraphSchema = z.object({
  type: z.literal('paragraph'),
  text: z.string()
})

export const listSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean().optional(),
  items: z.array(z.string())
})

export const tableSchema = z.object({
  type: z.literal('table'),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string()))
})

export const quoteSchema = z.object({
  type: z.literal('quote'),
  text: z.string()
})

export const codeSchema = z.object({
  type: z.literal('code'),
  language: z.string().optional(),
  code: z.string()
})

export const imageSchema = z.object({
  type: z.literal('image'),
  url: z.string(),
  alt: z.string().optional()
})

export const pageBreakSchema = z.object({
  type: z.literal('pageBreak')
})

export const documentBlockSchema = z.union([
  headingSchema,
  paragraphSchema,
  listSchema,
  tableSchema,
  quoteSchema,
  codeSchema,
  imageSchema,
  pageBreakSchema
])

export const documentAstSchema = z.object({
  type: z.literal('document'),
  metadata: z
    .object({
      title: z.string().optional(),
      author: z.string().optional(),
      language: z.string().optional()
    })
    .optional(),
  blocks: z.array(documentBlockSchema)
})

export function validateAstInput(
  value: unknown
): value is import('./types').DocumentAST {
  return documentAstSchema.safeParse(value).success
}
