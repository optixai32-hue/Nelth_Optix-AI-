'use client'

import { memo } from 'react'

import type { SearchResultItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isCitationLabel } from '@/lib/utils/citation'

import {
  Citation,
  CitationCarousel,
  CitationCarouselContent,
  CitationCarouselHeader,
  CitationCarouselIndex,
  CitationCarouselItem,
  CitationCarouselNext,
  CitationCarouselPagination,
  CitationCarouselPrev,
  CitationContent,
  CitationItem,
  CitationSourcesBadge,
  CitationTrigger
} from '@/components/nexus-ui/citation'

interface CitationLinkProps {
  href: string
  children: React.ReactNode
  className?: string
  citationData?: SearchResultItem
}

export const CitationLink = memo(function CitationLink({
  href,
  children,
  className,
  citationData
}: CitationLinkProps) {
  const childrenText = children?.toString() || ''
  const isCitation = isCitationLabel(childrenText)

  // Regular (non-citation) links stay untouched.
  if (!isCitation || !citationData) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'hover:underline inline-flex items-center gap-1.5',
          className
        )}
      >
        {children}
      </a>
    )
  }

  // Inline [n] citation powered by nexus-ui: the chip keeps the [n] label
  // (model contract) and the hover card shows the source preview through
  // the carousel composition (badge + prev/index/next), ready for
  // multi-source groups.
  return (
    <Citation
      citations={[
        {
          url: citationData.url,
          title: citationData.title,
          description: citationData.content
        }
      ]}
    >
      <CitationTrigger
        label={childrenText}
        showSiteName={false}
        className={cn(
          'gap-1 text-[10px] -translate-y-0.5 whitespace-nowrap no-underline',
          className
        )}
      />

      <CitationContent side="bottom" align="start" sideOffset={4}>
        <CitationCarousel>
          <CitationCarouselHeader>
            <CitationSourcesBadge />

            <CitationCarouselPagination>
              <CitationCarouselPrev />
              <CitationCarouselIndex />
              <CitationCarouselNext />
            </CitationCarouselPagination>
          </CitationCarouselHeader>

          <CitationCarouselContent>
            <CitationCarouselItem index={0}>
              <CitationItem />
            </CitationCarouselItem>
          </CitationCarouselContent>
        </CitationCarousel>
      </CitationContent>
    </Citation>
  )
})
