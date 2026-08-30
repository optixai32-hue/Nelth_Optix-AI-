/* eslint-disable @next/next/no-img-element */
'use client'

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState
} from 'react'

import { IconPhoto as Images } from '@tabler/icons-react'

import { SearchResultImage } from '@/lib/types'

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious
} from '@/components/ui/carousel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

import { ImageCreditOverlay } from '@/components/image-credit-overlay'

interface SearchResultsImageSectionProps {
  images: SearchResultImage[]
  query?: string
  displayMode?: 'preview' | 'full'
}

type NormalizedImage = { id: string; url: string; description: string }

const normalizeImages = (images: SearchResultImage[]): NormalizedImage[] => {
  if (!images || images.length === 0) {
    return []
  }

  return images
    .map((image, index) => {
      if (typeof image === 'string') {
        return {
          id: `${index}-${image}`,
          url: image,
          description: ''
        }
      }

      const url = image.url ?? ''
      return {
        id: `${index}-${url}`,
        url,
        description: image.description ?? ''
      }
    })
    .filter(img => Boolean(img.url))
}

const useFilteredImages = (images: SearchResultImage[]) => {
  const normalizedImages = useMemo(() => normalizeImages(images), [images])
  const status = normalizedImages.length === 0 ? 'empty' : 'ready'

  return {
    status,
    displayImages: normalizedImages
  }
}

const useCarouselMetrics = ({
  api,
  imageCount,
  selectedIndex,
  setSelectedIndex
}: {
  api: CarouselApi | undefined
  imageCount: number
  selectedIndex: number
  setSelectedIndex: Dispatch<SetStateAction<number>>
}) => {
  const [current, setCurrent] = useState<number | null>(null)

  useEffect(() => {
    if (!api) {
      return
    }

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap() + 1)
    }

    handleSelect()
    api.on('select', handleSelect)

    return () => {
      api.off('select', handleSelect)
    }
  }, [api])

  useEffect(() => {
    setSelectedIndex(prevIndex => {
      if (imageCount === 0) {
        return 0
      }
      return Math.min(prevIndex, imageCount - 1)
    })
  }, [imageCount, setSelectedIndex])

  useEffect(() => {
    if (!api || imageCount === 0) {
      return
    }

    const clampedIndex = Math.min(selectedIndex, imageCount - 1)
    api.scrollTo(clampedIndex, false)
  }, [api, selectedIndex, imageCount])

  const currentValue =
    imageCount === 0 ? 0 : (current ?? Math.min(selectedIndex + 1, imageCount))

  return { current: currentValue }
}

const cornerClassForIndex = (actualIndex: number, isFullMode: boolean) => {
  if (!isFullMode) {
    return 'rounded-lg'
  }

  if (actualIndex === 0) return 'rounded-tl-lg'
  if (actualIndex === 1) return 'rounded-tr-lg'
  if (actualIndex === 2) return 'rounded-bl-lg'
  if (actualIndex === 4) return 'rounded-br-lg'

  return ''
}

export const SearchResultsImageSection: React.FC<
  SearchResultsImageSectionProps
> = ({ images, query, displayMode = 'preview' }) => {
  const [api, setApi] = useState<CarouselApi>()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const { status, displayImages } = useFilteredImages(images)
  const imageCount = displayImages.length

  const { current } = useCarouselMetrics({
    api,
    imageCount,
    selectedIndex,
    setSelectedIndex
  })

  if (status === 'empty' || displayImages.length === 0) {
    return null
  }

  const handleSelect = (index: number) => {
    setSelectedIndex(index)
  }

  const renderImageGrid = (
    imageSubset: NormalizedImage[],
    gridClasses: string,
    startIndex: number = 0,
    isFullMode: boolean = false
  ) => (
    <div className={gridClasses}>
      {imageSubset.map((image, index) => {
        const actualIndex = startIndex + index
        const cornerClasses = cornerClassForIndex(actualIndex, isFullMode)

        return (
          <Dialog key={image.id}>
            <DialogTrigger asChild>
              <div
                className="aspect-video cursor-pointer relative overflow-hidden rounded-lg bg-muted/40 border border-border/50 transition-all duration-200 hover:scale-[1.02] hover:shadow-md"
                onClick={() => handleSelect(actualIndex)}
              >
                <div className="flex-1 h-full">
                  <div className="h-full w-full">
                    <img
                      src={image.url}
                      alt={`Image ${actualIndex + 1}`}
                      className={`h-full w-full object-cover shadow-sm ${cornerClasses}`}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  </div>
                </div>
                {!isFullMode &&
                  index === imageSubset.length - 1 &&
                  imageCount > 1 && (
                    <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                      <Images size={14} />
                      <span>{imageCount}</span>
                    </div>
                  )}
              </div>
            </DialogTrigger>
            <DialogContent className="max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-auto border border-white/10 bg-black/60 shadow-2xl backdrop-blur-md">
              <DialogHeader>
                <DialogTitle className="sr-only">Images</DialogTitle>
                <DialogDescription className="text-sm text-white/70">
                  {query}
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Carousel
                  setApi={setApi}
                  opts={{
                    startIndex: selectedIndex,
                    loop: imageCount > 1
                  }}
                  className="w-full max-h-[70vh]"
                >
                  <CarouselContent>
                    {displayImages.map((img, idx) => (
                      <CarouselItem key={img.id}>
                        <div className="relative w-full h-full flex items-center justify-center">
                          <img
                            src={img.url}
                            alt={`Image ${idx + 1}`}
                            className="max-w-full max-h-[70vh] object-contain rounded-md"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                          <ImageCreditOverlay
                            url={img.url}
                            description={img.description}
                          />
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  {imageCount > 1 && (
                    <div className="absolute inset-8 flex items-center justify-between p-4 pointer-events-none">
                      <CarouselPrevious className="size-10 rounded-full shadow-sm focus:outline-hidden pointer-events-auto">
                        <span className="sr-only">Previous</span>
                      </CarouselPrevious>
                      <CarouselNext className="size-10 rounded-full shadow-sm focus:outline-hidden pointer-events-auto">
                        <span className="sr-only">Next</span>
                      </CarouselNext>
                    </div>
                  )}
                </Carousel>
                <div className="py-2 text-center text-sm text-white/70">
                  {current} of {imageCount}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })}
    </div>
  )

  if (displayMode === 'full') {
    const firstRowImages = displayImages.slice(0, 2)
    const secondRowImages = displayImages.slice(2, 5)

    return (
      <div className="flex flex-col gap-2">
        {renderImageGrid(firstRowImages, 'grid grid-cols-2 gap-2', 0, true)}
        {secondRowImages.length > 0 &&
          renderImageGrid(secondRowImages, 'grid grid-cols-3 gap-2', 2, true)}
      </div>
    )
  }

  const previewImages = displayImages.slice(0, 4)
  return renderImageGrid(previewImages, 'grid grid-cols-4 gap-2')
}
