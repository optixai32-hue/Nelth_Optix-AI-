'use client'

import type { ToolPart } from '@/lib/types/ai'

import { ShimmerLabel } from '@/components/elements/surfaces'

type DocInput = { operation?: string; format?: string; fileName?: string }
type DocArtifact = { fileName?: string; downloadUrl?: string; mimeType?: string }
type DocOutput = {
  artifact?: DocArtifact
  success?: boolean
  text?: string
  pages?: number
}

function deriveFormat(input?: DocInput): string {
  const raw = input?.format || input?.fileName?.split('.').pop() || 'document'
  return raw.toUpperCase()
}

/**
 * Chat block for the `document` tool. While the file is being generated it shows
 * a simple shimmering line ("Generating your PDF…", "Generating your DOCX…", …);
 * once ready it links straight to the download.
 */
export function DocumentToolContent({ part }: { part: ToolPart<'document'> }) {
  const input = (part as unknown as { input?: DocInput }).input
  const output = (part as unknown as { output?: DocOutput }).output
  const artifact = output?.artifact
  const format = deriveFormat(input)
  const fileName =
    input?.fileName || artifact?.fileName || `document.${input?.format ?? 'pdf'}`

  const isGenerating =
    part.state === 'input-streaming' ||
    part.state === 'input-available' ||
    (part.state === 'output-available' && !artifact && output?.text == null)
  const isDone = part.state === 'output-available' && !!artifact
  // A read operation returns extracted text with no artifact — that is a
  // finished state, not a generation in progress.
  const isReadDone =
    part.state === 'output-available' &&
    !artifact &&
    typeof output?.text === 'string'
  const isError = part.state === 'output-error'

  return (
    <div className="my-2 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Document
        </span>
        <span className="truncate text-sm font-semibold">{fileName}</span>
      </div>

      <div className="mt-2 text-sm">
        {isError ? (
          <span className="text-destructive">Failed to generate document</span>
        ) : isDone && artifact?.downloadUrl ? (
          <a
            href={artifact.downloadUrl}
            download={artifact.fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            {format} ready — download
          </a>
        ) : isDone ? (
          <span className="text-muted-foreground">{format} ready</span>
        ) : isReadDone ? (
          <span className="text-muted-foreground">
            {format} read
            {typeof output?.pages === 'number' && output.pages > 0
              ? ` — ${output.pages} page${output.pages > 1 ? 's' : ''}`
              : ''}
          </span>
        ) : (
          <ShimmerLabel>Generating your {format}…</ShimmerLabel>
        )}
      </div>
    </div>
  )
}
