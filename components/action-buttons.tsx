'use client'

import { useEffect, useRef, useState } from 'react'

import {
  IconBulb as Bulb,
  IconPencil as Pencil,
  IconPhoto as Photo,
  IconSearch as Search,
  IconSettings as Settings,
  IconTool as Tool,
  IconX as X,
  type TablerIcon
} from '@tabler/icons-react'

import { captureClient } from '@/lib/analytics/posthog-client'
import { cn } from '@/lib/utils'

import { ConnectorCard } from './connector/connector-card'
import { Button } from './ui/button'
import {
  Stories,
  StoriesContent,
  StoriesNext,
  StoriesPrevious,
  Story,
  StoryAuthor,
  StoryAuthorName,
  StoryImage,
  StoryOverlay
} from './ui/stories-carousel'

// Constants for timing delays
const FOCUS_OUT_DELAY_MS = 100 // Delay to ensure focus has actually moved

interface ActionCategory {
  icon: TablerIcon
  label: string
  key: string
}

// Distinct hover animation per action category icon.
const CATEGORY_ICON_ANIM: Record<string, string> = {
  createimage: 'group-hover:scale-110 group-hover:rotate-6',
  troubleshoot: 'group-hover:rotate-12',
  howto: 'group-hover:rotate-90',
  understand: 'group-hover:scale-125',
  create: 'group-hover:-rotate-12'
}

const actionCategories: ActionCategory[] = [
  {
    icon: Photo,
    label: 'Create image',
    key: 'createimage'
  },
  {
    icon: Tool,
    label: 'Troubleshoot',
    key: 'troubleshoot'
  },
  {
    icon: Settings,
    label: 'How-to',
    key: 'howto'
  },
  {
    icon: Bulb,
    label: 'Understand',
    key: 'understand'
  },
  {
    icon: Pencil,
    label: 'Create',
    key: 'create'
  }
]

// Onboarding examples are tuned to showcase grounded, GenUI-rich answers
// (images, comparison tables, structured depth) for concrete, self-contained
// tasks — the patterns that correlate with follow-up in real usage. Keep each
// example self-contained (no "my notes"/"this file" referencing absent context).
const promptSamples: Record<string, string[]> = {
  troubleshoot: [
    'My car starts then immediately stalls, but the electronics still work',
    'Wi-Fi keeps dropping on one laptop but not my phone — how do I fix it?',
    "My sourdough starter isn't rising after a week — what's wrong?",
    'Next.js build fails with "Module not found" only in production'
  ],
  howto: [
    'Move my photos off Google Photos without losing albums',
    'Set up a Proxmox home server for self-hosting',
    'Convert a folder of .txt files to clean HTML',
    'Set up a Plex media server to stream my movies'
  ],
  createimage: [
    'Generate a cinematic portrait of a traveler at sunrise in the mountains',
    'Create a surreal cityscape with floating islands and waterfalls',
    'Design a cozy reading nook illustration in a soft, dreamy style',
    'Make a vibrant poster of a summer music festival at the beach'
  ],
  understand: [
    'What causes the northern lights?',
    'Why did the dinosaurs really go extinct?',
    'How does a nuclear reactor actually generate electricity?',
    // Timely slot — refresh seasonally (currently WWDC 2026).
    'What did Apple announce at WWDC 2026?'
  ],
  create: [
    'Draft a 5-question Ancient Rome quiz with A–D answers',
    'Outline a peer-support group for a prison setting',
    'Create a high-protein meal plan for a week on a budget',
    'Draft a beginner 3-day-per-week workout split'
  ]
}

interface StoryItem {
  id: number
  author: string
  avatar: string
  fallback: string
  prompt: string
}

const imageStories: StoryItem[] = [
  {
    id: 1,
    author: 'Accidental smartphone snapshot',
    avatar: '/images/carou/story-01.jpg',
    fallback: 'AS',
    prompt: `Turn the uploaded an ordinary accidental iPhone snapshot of an anonymous person, as if the camera opened while the phone was being pulled out of a pocket. No intentional composition, no polished portrait lighting, no obvious pose. Use a strange low angle, close lens distance, messy cropped frame, slight motion blur, imperfect focus, uneven interior lighting, one mildly overexposed bright window or edge, casual camera-roll realism, natural phone noise, unedited colors, awkward everyday framing, excessively real and unplanned.`
  },
  {
    id: 2,
    author: 'Dreamy Cloud Fantasy',
    avatar: '/images/carou/story-02.jpg',
    fallback: 'DC',
    prompt: `Transform the uploaded portrait into a dreamy cloud fantasy scene. Keep the person recognizable, preserve the main facial features, hairstyle, expression, skin tone, and outfit color cues, then place them among soft luminous clouds with glowing sky light. Add floating fabric, gentle wind movement, subtle sparkles, pastel atmospheric haze, soft rim light, peaceful surreal mood, airy depth, delicate highlights, and a calm cinematic fantasy portrait composition. Make the scene feel elegant, ethereal, and believable, not cartoonish, with the person naturally integrated into the clouds.`
  },
  {
    id: 3,
    author: 'Dreamy underwater fashion editorial',
    avatar: '/images/carou/story-03.jpg',
    fallback: 'DW',
    prompt: `Transform the uploaded photo into a dreamy underwater fashion portrait from the uploaded photo. Keep the face recognizable, add flowing fabric, soft blue light rays, floating bubbles, elegant movement, surreal calm expression, and premium editorial photography style. Use a vertical fashion editorial crop, graceful pose, natural facial proportions, realistic water refraction, soft skin texture, clean bubbles, and cinematic blue color grading.`
  },
  {
    id: 4,
    author: 'Exaggerated 3D Caricature Character Portrait',
    avatar: '/images/carou/story-04.jpg',
    fallback: 'EC',
    prompt: `Transform the uploaded an exaggerated stylized 3D caricature character portrait with strong intentional deformation and a clean, controlled surface finish. Use the person from the ATTACHED REFERENCE PHOTO. Preserve the subject's identity, facial likeness, skin tone, and defining features, but reinterpret them into a bold caricatured 3D form with an elongated neck, oversized head-to-neck ratio, droopy eyelids, heavy lips, and slightly asymmetrical facial structure. Render as a human-like 3D character with smooth, studio-clean skin and intentionally designed detail, avoiding random texture or noise. Style with bold accessories such as round or oval glasses, hoop earrings, gold chains, headscarves or bandanas, and street-luxury clothing.`
  },
  {
    id: 5,
    author: 'Funny Fashion Caricature',
    avatar: '/images/carou/story-05.jpg',
    fallback: 'FF',
    prompt: `Transform the uploaded photo into a funny but stylish fashion caricature portrait. Keep the person recognizable through broad facial structure, hairstyle, pose, outfit colors, and visible accessories, but exaggerate the body language, facial expression, hands, sleeves, hair, and outfit details in a playful editorial sketch style. Use rough black ink lines, confident contour strokes, soft watercolor washes, paper grain, loose splatters, arrows, handwritten notes, tiny doodles, and short fashion-comment captions around the figure. Make the page feel like a vintage magazine illustration or annotated fashion sketchbook spread: witty, stylish, slightly chaotic, but composed. Keep the humor affectionate and visual, avoid cruel caricature, avoid identity claims, and preserve one clear main subject.`
  },
  {
    id: 6,
    author: 'Luxury Perfume Advertisement',
    avatar: '/images/carou/story-06.jpg',
    fallback: 'LP',
    prompt: `Create a luxury perfume advertisement portrait from the uploaded photo. Keep the face recognizable, preserve the hairstyle, expression, skin tone, outfit cues, and overall identity. Add elegant cinematic beauty lighting, a reflective glass perfume bottle in the foreground, minimal premium background, soft shadows, glossy table reflections, refined highlights, shallow depth of field, polished retouching, premium fragrance brand-campaign mood, and a cinematic beauty-ad composition. Use tasteful fictional perfume styling without copying real brand logos or readable trademark text.`
  },
  {
    id: 7,
    author: 'Realistic Airport Travel',
    avatar: '/images/carou/story-07.jpg',
    fallback: 'RA',
    prompt: `Create a realistic airport travel editorial photo from the uploaded portrait. Keep the person recognizable, preserve the main facial features, hairstyle, expression, skin tone, and outfit cues, then place them in a modern airport terminal with a stylish suitcase. Add a polished travel outfit, soft morning light through large airport windows, subtle reflections on the floor, realistic background travelers slightly out of focus, natural shadows, premium lifestyle magazine composition, shallow depth of field, editorial color grading, and a calm confident travel mood. Make it look like a real high-end travel feature photo, not a collage or tourist snapshot.`
  },
  {
    id: 8,
    author: 'Realistic Luxury Car Advertisement Portrait',
    avatar: '/images/carou/story-08.jpg',
    fallback: 'RC',
    prompt: `Create a realistic luxury car advertisement portrait from the uploaded photo. Keep the person recognizable, place them beside a sleek car interior or exterior, add glossy reflections, city-night lighting, stylish outfit, and cinematic premium campaign mood. Use a polished square or vertical campaign crop, realistic skin texture, glossy black car reflections, city skyline bokeh, premium wardrobe styling, natural facial proportions, and clean commercial lighting.`
  },
  {
    id: 9,
    author: 'Realistic original superhero portrait',
    avatar: '/images/carou/story-09.jpg',
    fallback: 'RS',
    prompt: `Transform the uploaded photo into a realistic original superhero portrait. Keep the person clearly recognizable and preserve their natural facial features, hairstyle, age, skin tone, and identity. Turn them into a powerful cinematic hero with a unique custom superhero suit, not based on any existing comic-book character. Design a premium tactical superhero outfit with modern armor details, textured fabric, subtle metallic accents, glowing energy lines, a strong emblem on the chest, fitted gloves, and a dramatic cape or long coat if it looks natural. Make the person look confident, noble, brave, and powerful, with a serious heroic expression and strong posture. Place the hero in an epic cinematic environment: rooftop above a futuristic city, stormy skyline, glowing sunset, rain-soaked street, dramatic clouds, or a high-tech command room. Add dramatic rim lighting, cinematic side light, realistic shadows, wind movement in the clothing, subtle sparks or energy glow, shallow depth of field, high-detail textures, natural skin detail, and premium movie-poster atmosphere. The final image should look like a realistic big-budget superhero movie still: heroic, stylish, powerful, emotional, and believable, not cartoonish, not cosplay, and not a copy of any existing superhero.`
  },
  {
    id: 10,
    author: 'Royal Portrait',
    avatar: '/images/carou/story-10.jpg',
    fallback: 'RP',
    prompt: `Transform the uploaded person into a royal portrait painting. Keep the face recognizable, preserve the main facial features, hairstyle, expression, skin tone, and recognizable outfit cues, then dress the person in elegant historical royal clothing with rich velvet, silk, brocade, embroidery, jewelry, and regal accessories. Add an ornate palace-inspired background, soft painterly lighting, warm highlights, deep classical colors, rich fabric textures, subtle brushwork, dignified posture, and a museum-quality oil portrait style. Make it feel like an authentic historical royal portrait painting while avoiding real monarch likeness claims, readable text, modern logos, or costume-party styling.`
  },
  {
    id: 11,
    author: 'Stylish Man with Cartoon Twin on Urban Sidewalk',
    avatar: '/images/carou/story-11.jpg',
    fallback: 'SM',
    prompt: `Use the provided portrait photo as the character reference and create a cinematic outdoor street-style scene featuring the same person alongside a cute chibi cartoon version of himself. Keep the real person's face recognizable from the reference, with short dark hair, a well-groomed beard, black round sunglasses, a red leather jacket, white shirt with red tie, cream wide-leg trousers, black leather shoes, and a small keychain hanging from the belt. Pose him casually leaning against a tall metal pole with one leg crossed, looking slightly to the side. Place the cartoon version on the opposite side of the pole, mirroring the same outfit and pose with exaggerated cute proportions and curly cartoon hair. Set the scene on a clean modern sidewalk with light stone tiles and a minimalist glass building in the background. Use bright natural daylight, soft shadows, shallow depth of field, realistic textures, cinematic color grading, a 50mm DSLR look, high dynamic range, ultra-detailed 8K quality, and a polished Instagram aesthetic combining hyperrealistic photography with playful cartoon illustration.`
  },
  {
    id: 12,
    author: 'Surreal Mirror-World',
    avatar: '/images/carou/story-12.jpg',
    fallback: 'SW',
    prompt: `Transform the uploaded photo into a surreal mirror-world portrait from the uploaded photo. Keep the face recognizable, add multiple reflective glass panels, soft distortions, elegant lighting, abstract background, and a premium conceptual fashion-editorial look. Use a vertical editorial crop, controlled reflections, natural facial proportions, soft glass distortion, elegant highlights, abstract depth, and premium conceptual fashion lighting.`
  },
  {
    id: 13,
    author: 'Toy Action Figure Blister Pack',
    avatar: '/images/carou/story-13.jpg',
    fallback: 'TA',
    prompt: `Use the provided portrait photo as the character reference and create a stylized premium collectible action figure in a clear plastic blister pack. Keep the face recognizable from the reference while making the figure toy-like, friendly, and relaxed, with a natural smile and upright full-body pose inside the molded plastic tray. Match the packaging colors to the outfit in the photo and design the card back like a retail-ready collectible product. Add a bold header with the action figure name, a short subheading underneath, and three separate accessory compartments beside the figure. Each accessory should relate to visible cues from the photo, such as sunglasses, cycling gear, a backpack, a coffee cup, headphones, a medal, or a water bottle. Use professional product photography lighting, sharp packaging details, clean reflections on the blister plastic, realistic shelf depth, and readable label areas.`
  },
  {
    id: 14,
    author: 'Vintage newspaper front-page cover',
    avatar: '/images/carou/story-14.jpg',
    fallback: 'VN',
    prompt: `Turn the uploaded portrait into a stylish vintage newspaper cover. Keep the face recognizable, add black-and-white press photography, bold headline layout, halftone print texture, old paper grain, editorial columns, and a classic front-page design. Use a front-page crop with the portrait as the main image, strong newspaper masthead, balanced editorial columns, believable ink texture, aged paper tone, and clean vintage print composition.`
  },
  {
    id: 15,
    author: 'Vogue Cover Fashion Portrait with Playful Pose',
    avatar: '/images/carou/story-15.jpg',
    fallback: 'VF',
    prompt: `Use the uploaded face as the original reference and create a realistic Vogue magazine cover-style fashion portrait with 100% facial feature retention. Keep her identity, natural facial structure, and beauty fully recognizable. Show a young elegant woman posing confidently, winking with her left eye and playfully puckering her lips while forming a heart gesture with both hands beside her cheeks. Surround her with DSLR cameras and smartphones, as if paparazzi and professional photographers are capturing her from every direction, with some phone screens displaying her live image. Give her luminous natural skin, soft blush, glossy pink lips, subtle highlighter, and sleek light brown or black hair tied in a low bun with a few loose strands framing her face. Dress her in a simple off-white strapless evening gown with a Louis Vuitton necklace, diamond rings, and elegant luxury jewelry. Use a close-up to half-body composition, professional Vogue editorial photography, cinematic studio lighting, realistic skin texture, soft HDR background, shallow depth of field, 85mm lens, f/1.8 aperture, sharp focus, natural bokeh, and ultra-detailed 8K quality. Add a minimalist Vogue magazine cover layout with a large logo at the top and elegant fashion-cover styling. Make the final result playful, luxurious, realistic, natural, and professionally photographed, avoiding any artificial or AI-generated appearance.`
  }
]

function ImageStories({
  onStoryClick
}: {
  onStoryClick: (story: StoryItem) => void
}) {
  return (
    <Stories>
      <StoriesContent>
        {imageStories.map(story => (
          <Story
            className="aspect-[3/4] w-[170px]"
            key={story.id}
            onClick={() => onStoryClick(story)}
          >
            <StoryImage
              src={`/images/carou/story-${String(story.id).padStart(2, '0')}.jpg`}
              alt={story.author}
            />
            <StoryOverlay />
            <StoryAuthor>
              <StoryAuthorName>{story.author}</StoryAuthorName>
            </StoryAuthor>
          </Story>
        ))}
      </StoriesContent>
      <div
        onMouseDown={e => e.stopPropagation()}
        onBlur={e => e.stopPropagation()}
        className="absolute top-full left-1/2 mt-3 flex -translate-x-1/2 items-center gap-3"
      >
        <StoriesPrevious className="!static left-auto right-auto top-auto translate-y-0" />
        <StoriesNext className="!static left-auto right-auto top-auto translate-y-0" />
      </div>
    </Stories>
  )
}

function StoryPromptPanel({
  story,
  onClose,
  onAttach
}: {
  story: StoryItem
  onClose: () => void
  onAttach: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string>('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(file))
      setPendingFile(file)
    }
    e.target.value = ''
  }

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight">
            {story.author}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
           >
             <X className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:rotate-90" />
          </button>
        </div>

        {/* Small thumbnail of the image selected from the stories carousel */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
          <img
            src={story.avatar}
            alt={story.author}
            className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
          />
          <span className="text-sm text-muted-foreground">
            Image sélectionnée
          </span>
        </div>

        {/* Preview of the uploaded image */}
        {preview && (
          <div className="mt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Aperçu de votre photo"
              className="max-h-56 w-full rounded-xl object-contain"
            />
          </div>
        )}

        <p className="mt-4 text-sm text-muted-foreground">
          Joignez une photo pour générer cette image.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {pendingFile ? (
          <Button
            type="button"
            onClick={() => {
              onAttach(pendingFile)
              onClose()
            }}
            className="mt-3 w-full gap-2 rounded-xl bg-foreground text-background transition-opacity hover:opacity-90"
          >
            <Photo className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 active:scale-90" />
            Générer avec cette photo
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 w-full gap-2 rounded-xl bg-foreground text-background transition-opacity hover:opacity-90"
          >
            <Photo className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 active:scale-90" />
            Joindre une photo
          </Button>
        )}
      </div>
    </div>
  )
}

interface ActionButtonsProps {
  onSelectPrompt: (prompt: string) => void
  onCategoryClick: (category: string) => void
  onAttachImageAndPrompt: (file: File, prompt: string) => void
  isGuest?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement>
  className?: string
}

export function ActionButtons({
  onSelectPrompt,
  onCategoryClick,
  onAttachImageAndPrompt,
  isGuest,
  inputRef,
  className
}: ActionButtonsProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedStory, setSelectedStory] = useState<StoryItem | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Hide the "Create image" category for guest accounts
  const visibleCategories = isGuest
    ? actionCategories.filter(category => category.key !== 'createimage')
    : actionCategories

  const handleCategoryClick = (category: ActionCategory) => {
    setActiveCategory(category.key)
    onCategoryClick(category.label)
    captureClient('example_category_opened', { category: category.key })
  }

  const handlePromptClick = (prompt: string) => {
    captureClient('example_prompt_clicked', {
      category: activeCategory,
      prompt
    })
    setActiveCategory(null)
    onSelectPrompt(prompt)
  }

  const resetToButtons = () => {
    setActiveCategory(null)
  }

  // Handle Escape key and clicks outside (including focus loss)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeCategory) {
        resetToButtons()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(e.target as Node)
    ) {
      if (activeCategory && activeCategory !== 'createimage') {
        // Check if click is not on the input field
        if (!inputRef?.current?.contains(e.target as Node)) {
          resetToButtons()
        }
      }
    }
    }

    const handleFocusOut = () => {
      // Check if focus is moving outside both the container and input
      setTimeout(() => {
        const activeElement = document.activeElement
      if (
        activeCategory &&
        activeCategory !== 'createimage' &&
        !containerRef.current?.contains(activeElement) &&
        activeElement !== inputRef?.current
      ) {
        resetToButtons()
      }
      }, FOCUS_OUT_DELAY_MS)
    }

    document.addEventListener('keydown', handleEscape)
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [activeCategory, inputRef])

  // Max height for samples (4 items up to 2 lines each + padding); overflow scrolls.
  // The image stories carousel needs more vertical room for its 3/4 tiles.
  const containerHeight =
    activeCategory === 'createimage' ? 'h-[320px]' : 'h-[232px]'

  return (
    <div
      ref={containerRef}
      className={cn('relative', containerHeight, className)}
    >
      <div className="relative h-full">
        {/* Action buttons */}
        <div
          className={cn(
            'absolute inset-0 flex items-start justify-center pt-2 transition-opacity duration-[180ms] ease-[var(--motion-ease-out)]',
            activeCategory ? 'opacity-0 pointer-events-none' : 'opacity-100'
          )}
        >
          <div className="relative flex flex-wrap justify-center gap-2 px-2">
            {visibleCategories.map(category => {
              const Icon = category.icon
              return (
                <Button
                  key={category.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'group flex items-center gap-2 whitespace-nowrap rounded-full',
                    'text-xs sm:text-sm px-3 sm:px-4'
                  )}
                  onClick={() => handleCategoryClick(category)}
                >
                  <Icon
                    className={cn(
                      'h-3 w-3 sm:h-4 sm:w-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)]',
                      CATEGORY_ICON_ANIM[category.key]
                    )}
                  />
                  <span>{category.label}</span>
                </Button>
              )
            })}
            {/* Connector Card: anchored to the chips row itself (not the
                fixed-height container), so it sits 1px below the chips with
                zero impact on the logo, greeting, composer and chips. */}
            <div className="absolute inset-x-0 top-full z-10 mt-3 flex justify-center px-2">
              <ConnectorCard className="w-full max-w-[530px]" />
            </div>
          </div>
        </div>

        {/* Prompt samples / image stories */}
        <div
          className={cn(
            'absolute inset-0 space-y-1 overflow-hidden py-1 transition-opacity duration-[180ms] ease-[var(--motion-ease-out)]',
            !activeCategory ? 'opacity-0 pointer-events-none' : 'opacity-100'
          )}
        >
          {activeCategory === 'createimage' ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-sm font-medium">
                  Découvrez des idées
                </span>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  aria-label="Fermer"
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
            <X className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:rotate-90" />
                </button>
              </div>
              <ImageStories onStoryClick={story => setSelectedStory(story)} />
            </div>
          ) : (
            activeCategory &&
            promptSamples[activeCategory]?.map((prompt, index) => (
              <button
                key={index}
                type="button"
                className={cn(
                  'w-full rounded-md px-3 py-2 text-left text-sm',
                  'transition-colors duration-[140ms] ease-[var(--motion-ease-out)] hover:bg-muted',
                  'flex items-center gap-2 group'
                )}
                onClick={() => handlePromptClick(prompt)}
              >
                <Search className="h-3 w-3 text-muted-foreground flex-shrink-0 group-hover:text-foreground" />
                <span className="line-clamp-2">{prompt}</span>
              </button>
            ))
          )}
        </div>
      </div>
      {selectedStory && (
        <StoryPromptPanel
          story={selectedStory}
          onClose={() => setSelectedStory(null)}
          onAttach={file => onAttachImageAndPrompt(file, selectedStory.prompt)}
        />
      )}
    </div>
  )
}
