'use client'

import type { ToolPart } from '@/lib/types/ai'

import { DocumentToolContent } from '@/components/artifact/document-tool-content'
import { SearchArtifactContent } from '@/components/artifact/search-artifact-content'

export function ToolInvocationContent({ part }: { part: ToolPart }) {
  switch (part.type) {
    case 'tool-search':
      return <SearchArtifactContent tool={part as ToolPart<'search'>} />
    case 'tool-document':
      return <DocumentToolContent part={part as ToolPart<'document'>} />
    default:
      return <div className="p-4">Details for this tool are not available</div>
  }
}
