'use client'

import { createMathPlugin } from '@streamdown/math'
import {
  defaultRehypePlugins,
  Streamdown
} from 'streamdown'

import { mergeStreamdownSpecRenderer } from '@/lib/render/streamdown-spec'
import { cn } from '@/lib/utils'

import { defaultComponents } from '@/components/assistant-ui/markdown-text'

import 'katex/dist/katex.min.css'

export function ReasoningContent({ reasoning }: { reasoning: string }) {
  const streamdownProps = mergeStreamdownSpecRenderer({
    math: createMathPlugin({ singleDollarTextMath: true })
  })
  return (
    <div className="overflow-auto">
      <div className={cn('prose-sm dark:prose-invert max-w-none')}>
        <Streamdown
          plugins={streamdownProps}
          rehypePlugins={Object.values(defaultRehypePlugins)}
          components={defaultComponents as never}
        >
          {reasoning}
        </Streamdown>
      </div>
    </div>
  )
}
