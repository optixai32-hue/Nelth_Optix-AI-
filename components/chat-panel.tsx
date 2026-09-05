'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import Textarea from 'react-textarea-autosize'
import { useRouter } from 'next/navigation'

import { UseChatHelpers } from '@ai-sdk/react'
import {
  IconArrowsDiagonal as ArrowsDiagonal,
  IconArrowUp as ArrowUp,
  IconChevronDown as ChevronDown,
  IconFileText as FileText,
  IconLibrary as LibraryIcon,
  IconMessageCirclePlus as MessageCirclePlus,
  IconPaperclip as Paperclip,
  IconPlus as Plus,
  IconSquare as Square,
  IconX as X
} from '@tabler/icons-react'
import { toast } from 'sonner'

import { captureClient } from '@/lib/analytics/posthog-client'
import { ALLOWED_UPLOAD_MIME_TYPES } from '@/lib/constants'
import { SHORTCUT_EVENTS } from '@/lib/keyboard-shortcuts'
import {
  isAdaptiveModeAuthBlocked,
  requiresAdaptiveModeAuth
} from '@/lib/search-mode-availability'
import { NoteContext, UploadedFile } from '@/lib/types'
import type { UIDataTypes, UIMessage, UITools } from '@/lib/types/ai'
import type { ModelSelectorData } from '@/lib/types/model-selector'
import type { SearchMode } from '@/lib/types/search'
import { cn } from '@/lib/utils'
import {
  getCookie,
  setCookie,
  subscribeToCookieChange
} from '@/lib/utils/cookies'
import { stripMarkdownText } from '@/lib/utils/markdown'

import { useAuthCheck } from '@/hooks/use-auth-check'

import { useArtifact } from './artifact/artifact-context'
import { useLibrary } from './library/library-context'
import { LibraryPickerDialog } from './library/library-picker-dialog'
import { Button } from './ui/button'
import { IconBlinkingLogo } from './ui/icons'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip'
import { ActionButtons } from './action-buttons'
import { useI18n } from './i18n-provider'
import { MessageNavigationDots } from './message-navigation-dots'
import { SearchModeSelector } from './search-mode-selector'
import { UploadedFileList } from './uploaded-file-list'

// Constants for timing delays
const INPUT_UPDATE_DELAY_MS = 10 // Delay to ensure input value is updated before form submission
// Only paste events at/over this size become a content card, so short/normal
// pastes stay inline. Sized by chars, not lines — a line-count trigger carded
// short, many-line pastes that read fine inline and were mostly reverted.
const PASTE_CARD_MIN_CHARS = 400
// A paste that is a single bare URL becomes a lightweight favicon chip.
// L0 prototype: client-only, no fetch — the URL rides into the query at send
// time so the existing fetch tool picks it up.
const BARE_URL_RE = /^https?:\/\/\S+$/
const ALLOWED_FILE_TYPES: string[] = [...ALLOWED_UPLOAD_MIME_TYPES]

function getSearchModeSnapshot(): SearchMode {
  return getCookie('searchMode') === 'adaptive' ? 'adaptive' : 'quick'
}

interface ChatPanelProps {
  chatId: string
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  status: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  messages: UIMessage[]
  setMessages: (messages: UIMessage[]) => void
  query?: string
  stop: () => void
  append: (message: any) => void
  /** Whether to show the scroll to bottom button */
  showScrollToBottomButton: boolean
  /** Reference to the scroll container */
  scrollContainerRef: React.RefObject<HTMLDivElement>
  uploadedFiles: UploadedFile[]
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>
  quotedContexts: string[]
  setQuotedContexts: React.Dispatch<React.SetStateAction<string[]>>
  noteContexts: NoteContext[]
  setNoteContexts: React.Dispatch<React.SetStateAction<NoteContext[]>>
  /** Callback to reset chatId when starting a new chat */
  onNewChat?: () => void
  /** Whether the current session is guest */
  isGuest?: boolean
  /** Whether the deployment is cloud mode */
  isCloudDeployment?: boolean
  onAdaptiveModeAuthRequired?: () => void
  modelSelectorData?: ModelSelectorData
  /** Chat sections for message navigation dots */
  sections?: { id: string; userMessage: UIMessage }[]
}

export function ChatPanel({
  chatId,
  input,
  handleInputChange,
  handleSubmit,
  status,
  messages,
  setMessages,
  query,
  stop,
  append,
  showScrollToBottomButton,
  uploadedFiles,
  setUploadedFiles,
  quotedContexts,
  setQuotedContexts,
  noteContexts,
  setNoteContexts,
  scrollContainerRef,
  onNewChat,
  isGuest = false,
  isCloudDeployment = false,
  onAdaptiveModeAuthRequired,
  modelSelectorData,
  sections = []
}: ChatPanelProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentMenuRef = useRef<HTMLDivElement>(null)
  const noteContextsRef = useRef(noteContexts)
  const uploadedFilesRef = useRef(uploadedFiles)
  const isFirstRender = useRef(true)
  const [isComposing, setIsComposing] = useState(false) // Composition state
  const [enterDisabled, setEnterDisabled] = useState(false) // Disable Enter after composition ends

  const { user } = useAuthCheck()
  const { t, greetingPhrases } = useI18n()
  const rawName = user?.name || user?.email?.split('@')[0] || ''
  // Display only the first name (prénom), capitalized.
  const firstName = rawName.split(/\s+/)[0] || ''
  const displayName =
    firstName.charAt(0).toUpperCase() + firstName.slice(1)
  // Stable initial value for SSR/first client render (no Math.random during
  // render) to avoid hydration mismatches; randomized on the client after mount.
  const [greeting, setGreeting] = useState(
    () => `${t('chat.hello')}, ${greetingPhrases[0]}`
  )

  useEffect(() => {
    const phrase =
      greetingPhrases[Math.floor(Math.random() * greetingPhrases.length)]
    setGreeting(
      `${t('chat.hello')}${displayName ? ` ${displayName}` : ''}, ${phrase}`
    )
  }, [displayName, chatId, t, greetingPhrases])
  const [isInputFocused, setIsInputFocused] = useState(false) // Track input focus
  // Large pastes become separate "content cards" (the target), keeping the
  // textarea for the instruction. See PASTE_CARD_MIN_CHARS.
  const [contentCards, setContentCards] = useState<string[]>([])
  // A single pasted URL becomes a lightweight favicon chip (see BARE_URL_RE).
  const [urlCards, setUrlCards] = useState<string[]>([])
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false)
  const { close: closeArtifact } = useArtifact()
  const { upsertCachedFile } = useLibrary()
  const isLoading = status === 'submitted' || status === 'streaming'
  const hasPendingInput =
    input.trim().length > 0 ||
    contentCards.length > 0 ||
    quotedContexts.length > 0 ||
    noteContexts.length > 0 ||
    urlCards.length > 0 ||
    uploadedFiles.some(file => file.status === 'uploaded')
  const hasAvailableModels =
    isCloudDeployment || modelSelectorData?.hasAvailableModels !== false
  const searchMode = useSyncExternalStore(
    subscribeToCookieChange,
    getSearchModeSnapshot,
    () => 'quick' as SearchMode
  )
  const isAdaptiveAuthRequired = requiresAdaptiveModeAuth({
    isGuest,
    isCloudDeployment
  })
  // Guests are limited to Quick mode. The SearchModeSelector already prompts
  // to sign in when Adaptive is clicked, so the submit guard must not block
  // Quick-mode sends for guests (a stale 'adaptive' cookie would otherwise
  // pop the auth modal on every message).
  const adaptiveModeSubmitBlocked = isGuest
    ? false
    : isAdaptiveModeAuthBlocked({
        mode: searchMode,
        isGuest,
        isCloudDeployment
      })

  const handleCompositionStart = () => setIsComposing(true)

  const handleCompositionEnd = () => {
    setIsComposing(false)
    // Brief debounce — the candidate-confirm Enter that fires
    // immediately after compositionend may otherwise be treated as a
    // submit. 50ms is enough to swallow that synchronous event but
    // short enough not to drop a real "finish typing, press Enter".
    setEnterDisabled(true)
    setTimeout(() => {
      setEnterDisabled(false)
    }, 50)
  }

  useEffect(() => {
    noteContextsRef.current = noteContexts
  }, [noteContexts])

  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles
  }, [uploadedFiles])

  const handleNewChat = useCallback(() => {
    setMessages([])
    closeArtifact()
    // Reset focus state when clearing chat
    setIsInputFocused(false)
    inputRef.current?.blur()
    // Reset chatId in parent component
    onNewChat?.()
    router.push('/')
  }, [setMessages, closeArtifact, onNewChat, router])

  // Listen for keyboard shortcut events
  // Uses defaultPrevented to prevent duplicate handling
  // when multiple ChatPanel instances are mounted (Next.js component caching)
  const handleNewChatRef = useRef(handleNewChat)
  useEffect(() => {
    handleNewChatRef.current = handleNewChat
  }, [handleNewChat])

  useEffect(() => {
    const handleNewChatShortcut = (e: Event) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      handleNewChatRef.current()
    }

    window.addEventListener(SHORTCUT_EVENTS.newChat, handleNewChatShortcut)
    return () => {
      window.removeEventListener(SHORTCUT_EVENTS.newChat, handleNewChatShortcut)
    }
  }, [])

  const isToolInvocationInProgress = () => {
    if (!messages.length) return false

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'assistant' || !lastMessage.parts) return false

    const parts = lastMessage.parts
    const lastPart = parts[parts.length - 1]

    return (
      (lastPart?.type === 'tool-search' ||
        lastPart?.type === 'tool-fetch' ||
        lastPart?.type === 'tool-askQuestion' ||
        lastPart?.type === 'tool-gmail' ||
        lastPart?.type === 'tool-drive' ||
        lastPart?.type === 'tool-calendar' ||
        lastPart?.type === 'tool-github' ||
        lastPart?.type === 'tool-notion') &&
      ((lastPart as any)?.state === 'input-streaming' ||
        (lastPart as any)?.state === 'input-available')
    )
  }

  // if query is not empty, submit the query
  useEffect(() => {
    if (isFirstRender.current && query && query.trim().length > 0) {
      if (adaptiveModeSubmitBlocked) {
        setCookie('searchMode', 'quick')
        return
      }

      append({
        role: 'user',
        parts: [{ type: 'text', text: query }]
      })
      isFirstRender.current = false
    }
  }, [adaptiveModeSubmitBlocked, append, query])

  const handleFileRemove = useCallback(
    (index: number) => {
      setUploadedFiles(prev => prev.filter((_, i) => i !== index))
    },
    [setUploadedFiles]
  )

  const uploadSelectedFiles = useCallback(
    async (files: File[]) => {
      const validFiles = files
        .slice(0, 3)
        .filter(file => ALLOWED_FILE_TYPES.includes(file.type))
      const rejected = files.filter(
        file => !ALLOWED_FILE_TYPES.includes(file.type)
      )

      if (rejected.length > 0) {
        toast.error(
          'Some files were not accepted: ' +
            rejected.map(file => file.name).join(', ')
        )
      }

      if (validFiles.length === 0) return

      const newFiles: UploadedFile[] = validFiles.map(file => ({
        file,
        status: 'uploading',
        mediaType: file.type
      }))
      setUploadedFiles(prev => [...prev, ...newFiles])
      await Promise.all(
        newFiles.map(async uf => {
          if (!uf.file) return
          const formData = new FormData()
          formData.append('file', uf.file)
          formData.append('chatId', chatId)
          try {
            const res = await fetch('/api/upload', {
              method: 'POST',
              body: formData
            })

            if (!res.ok) {
              const data = await res.json().catch(() => null)
              throw new Error(data?.error || data?.message || 'Upload failed')
            }

            const { file: uploaded } = await res.json()
            if (uploaded.libraryFile) {
              upsertCachedFile(uploaded.libraryFile)
            }
            setUploadedFiles(prev =>
              prev.map(f =>
                f.file === uf.file
                  ? {
                      ...f,
                      status: 'uploaded',
                      url: uploaded.url,
                      name: uploaded.filename,
                      key: uploaded.key,
                      mediaType: uploaded.mediaType,
                      libraryFileId: uploaded.id
                    }
                  : f
              )
            )
          } catch (e) {
            const reason =
              e instanceof Error &&
              e.message &&
              e.message !== 'Upload failed'
                ? `: ${e.message}`
                : ''
            toast.error(`Failed to upload ${uf.file.name}${reason}`)
            setUploadedFiles(prev =>
              prev.map(f =>
                f.file === uf.file ? { ...f, status: 'error' } : f
              )
            )
          }
        })
      )
    },
    [chatId, setUploadedFiles, upsertCachedFile]
  )

  const handleAttachNote = useCallback(
    (note: NoteContext) => {
      if (noteContextsRef.current.some(item => item.id === note.id)) {
        return false
      }
      noteContextsRef.current = [...noteContextsRef.current, note]
      setNoteContexts(prev =>
        prev.some(item => item.id === note.id) ? prev : [...prev, note]
      )
      toast.success('Note attached')
      return true
    },
    [setNoteContexts]
  )

  const handleAttachLibraryFile = useCallback(
    (file: UploadedFile) => {
      if (
        file.libraryFileId &&
        uploadedFilesRef.current.some(
          item => item.libraryFileId === file.libraryFileId
        )
      ) {
        return false
      }
      uploadedFilesRef.current = [...uploadedFilesRef.current, file]
      setUploadedFiles(prev =>
        file.libraryFileId &&
        prev.some(item => item.libraryFileId === file.libraryFileId)
          ? prev
          : [...prev, file]
      )
      toast.success('File attached')
      return true
    },
    [setUploadedFiles]
  )

  const openLibraryPicker = useCallback(() => {
    setIsAttachmentMenuOpen(false)
    setIsLibraryPickerOpen(true)
  }, [])

  useEffect(() => {
    if (!isAttachmentMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (
        attachmentMenuRef.current &&
        !attachmentMenuRef.current.contains(event.target as Node)
      ) {
        setIsAttachmentMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsAttachmentMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAttachmentMenuOpen])

  // Scroll to the bottom of the container
  const handleScrollToBottom = () => {
    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth'
      })
    }
  }

  return (
    <div
      className={cn(
        'w-full bg-background group/form-container shrink-0',
        messages.length > 0
          ? 'sticky bottom-0 px-2 pb-2 md:pb-4'
          : 'px-4 md:px-6'
      )}
    >
      {messages.length === 0 && (
        <div
          data-testid="empty-hero"
          className="mb-6 flex flex-col items-center gap-2 md:mb-10 md:gap-4 [@media(max-height:720px)]:mb-3 [@media(max-height:720px)]:gap-2"
        >
          <IconBlinkingLogo className="size-16 [@media(max-height:720px)]:size-12" />
          <h1 className="text-xl font-medium text-foreground md:text-2xl [@media(max-height:720px)]:text-lg">
            {greeting}
          </h1>
        </div>
      )}
      <form
        onSubmit={e => {
          // Pasted attachments (content cards / URL chips) are sent as
          // structured data parts alongside the instruction text part — no
          // in-band markers. The server maps them to the model prompt.
          if (
            contentCards.length > 0 ||
            quotedContexts.length > 0 ||
            noteContexts.length > 0 ||
            urlCards.length > 0 ||
            uploadedFiles.some(file => file.status === 'uploaded')
          ) {
            e.preventDefault()
            if (adaptiveModeSubmitBlocked) {
              onAdaptiveModeAuthRequired?.()
              return
            }
            if (!hasAvailableModels) {
              toast.error('No enabled model is available')
              return
            }
            const uploaded = uploadedFiles.filter(f => f.status === 'uploaded')
            const parts = [
              ...contentCards.map(text => ({
                type: 'data-pastedContent',
                data: { text }
              })),
              ...quotedContexts.map(text => ({
                type: 'data-quotedContext',
                data: { text }
              })),
              ...noteContexts.map(note => ({
                type: 'data-noteContext',
                data: { title: note.title, text: note.content }
              })),
              ...urlCards.map(url => ({
                type: 'data-sourceUrl',
                data: { url }
              })),
              ...uploaded.map(f => ({
                type: 'file',
                url: f.url!,
                filename: f.name ?? f.file?.name ?? 'Attached file',
                mediaType:
                  f.mediaType ?? f.file?.type ?? 'application/octet-stream',
                key: f.key
              })),
              ...(input.trim() ? [{ type: 'text', text: input }] : [])
            ]
            if (contentCards.length > 0) {
              captureClient('content_card_submitted', {
                cardCount: contentCards.length,
                chars: contentCards.reduce((sum, c) => sum + c.length, 0)
              })
            }
            if (urlCards.length > 0) {
              captureClient('url_card_submitted', {
                cardCount: urlCards.length
              })
            }
            if (noteContexts.length > 0) {
              captureClient('note_context_submitted', {
                count: noteContexts.length,
                chars: noteContexts.reduce(
                  (sum, note) => sum + note.content.length,
                  0
                )
              })
            }
            const libraryFiles = uploaded.filter(file => file.libraryFileId)
            if (libraryFiles.length > 0) {
              captureClient('library_file_submitted', {
                count: libraryFiles.length
              })
            }
            setContentCards([])
            setQuotedContexts([])
            setNoteContexts([])
            setUrlCards([])
            setUploadedFiles([])
            handleInputChange({
              target: { value: '' }
            } as React.ChangeEvent<HTMLTextAreaElement>)
            append({ role: 'user', parts })
            setIsInputFocused(false)
            inputRef.current?.blur()
            return
          }
          if (adaptiveModeSubmitBlocked) {
            e.preventDefault()
            onAdaptiveModeAuthRequired?.()
            return
          }

          if (!hasAvailableModels) {
            e.preventDefault()
            toast.error('No enabled model is available')
            return
          }
          handleSubmit(e)
          // Reset focus state after submission
          setIsInputFocused(false)
          inputRef.current?.blur()
        }}
        className={cn('max-w-full md:max-w-3xl w-full mx-auto relative')}
      >
        {/* Scroll to bottom button */}
        {messages.length > 0 && (
          <div
            className={cn(
              'transition-opacity duration-[120ms] ease-[var(--motion-ease-out)]',
              showScrollToBottomButton
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            )}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute -top-10 right-0 z-20 size-8 rounded-full shadow-md"
              onClick={handleScrollToBottom}
              title="Scroll to bottom"
            >
              <ChevronDown size={16} />
            </Button>
          </div>
        )}
        {/* Message navigation dots */}
        {sections.length > 0 && (
          <div
            className={cn(
              'transition-opacity duration-[120ms] ease-[var(--motion-ease-out)]',
              !showScrollToBottomButton && status === 'ready'
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            )}
          >
            <MessageNavigationDots sections={sections} />
          </div>
        )}

        <div
          className={cn(
            'relative flex w-full flex-col gap-2 rounded-3xl border border-input bg-muted transition-[box-shadow] duration-[140ms] ease-[var(--motion-ease-out)]',
            isInputFocused &&
              'ring-1 ring-ring/20 ring-offset-1 ring-offset-background/50'
          )}
        >
          {contentCards.length > 0 && (
            <div className="flex flex-col gap-1.5 px-3 pt-3">
              {contentCards.map((card, i) => (
                <div
                  key={i}
                  className="relative rounded-xl border border-input bg-background px-3 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileText className="size-3.5 shrink-0" />
                      Pasted content · {card.length.toLocaleString()} chars
                    </span>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Expand to text"
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => {
                              captureClient('content_card_expanded', {
                                chars: card.length
                              })
                              setContentCards(prev =>
                                prev.filter((_, j) => j !== i)
                              )
                              handleInputChange({
                                target: {
                                  value: input ? `${input}\n\n${card}` : card
                                }
                              } as React.ChangeEvent<HTMLTextAreaElement>)
                              inputRef.current?.focus()
                            }}
                          >
                            <ArrowsDiagonal className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          Expand to text
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground/80">
                    {card}
                  </p>
                </div>
              ))}
            </div>
          )}
          {quotedContexts.length > 0 && (
            <div className="flex flex-col gap-1.5 px-3 pt-3">
              {quotedContexts.map((card, i) => (
                <div
                  key={i}
                  className="relative rounded-xl border border-input bg-background px-3 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileText className="size-3.5 shrink-0" />
                      Quoted context · {card.length.toLocaleString()} chars
                    </span>
                    <button
                      type="button"
                      aria-label="Remove quoted context"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setQuotedContexts(prev =>
                          prev.filter((_, j) => j !== i)
                        )
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground/80">
                    {card}
                  </p>
                </div>
              ))}
            </div>
          )}
          {noteContexts.length > 0 && (
            <div className="flex flex-col gap-1.5 px-3 pt-3">
              {noteContexts.map((note, i) => (
                <div
                  key={note.id}
                  className="relative rounded-xl border border-input bg-background px-3 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">
                        Note: {stripMarkdownText(note.title) || 'Untitled note'}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Remove note"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setNoteContexts(prev => prev.filter((_, j) => j !== i))
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground/80">
                    {stripMarkdownText(note.content)}
                  </p>
                </div>
              ))}
            </div>
          )}
          {urlCards.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {urlCards.map((url, i) => {
                let host = url
                try {
                  host = new URL(url).host.replace(/^www\./, '')
                } catch {}
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full border border-input bg-background py-1 pl-2 pr-1 text-xs text-muted-foreground"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      className="size-3.5 shrink-0 rounded-sm"
                    />
                    <span className="max-w-[180px] truncate">{host}</span>
                    <button
                      type="button"
                      aria-label="Remove URL"
                      className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        captureClient('url_card_removed')
                        setUrlCards(prev => prev.filter((_, j) => j !== i))
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
          {uploadedFiles.length > 0 && (
            <UploadedFileList files={uploadedFiles} onRemove={handleFileRemove} />
          )}
          <Textarea
            ref={inputRef}
            name="input"
            rows={2}
            maxRows={5}
            tabIndex={0}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            placeholder={
              messages.length > 0 ? t('chat.reply') : t('chat.placeholder')
            }
            spellCheck={false}
            value={input}
            disabled={isLoading || isToolInvocationInProgress()}
            className="resize-none w-full min-h-12 bg-transparent border-0 p-3 md:p-4 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
            onChange={handleInputChange}
            onPaste={e => {
              const text = e.clipboardData.getData('text')
              const trimmed = text.trim()
              // Only when the textarea is empty — a URL pasted mid-sentence
              // should stay inline, not get yanked into a chip.
              if (BARE_URL_RE.test(trimmed) && input.trim().length === 0) {
                e.preventDefault()
                setUrlCards(prev => [...prev, trimmed])
                captureClient('url_card_created')
                return
              }
              if (text.length >= PASTE_CARD_MIN_CHARS) {
                e.preventDefault()
                setContentCards(prev => [...prev, text])
                captureClient('content_card_created', {
                  chars: text.length,
                  lines: text.split('\n').length
                })
              }
            }}
            onKeyDown={e => {
              // e.nativeEvent.isComposing stays true on the keydown that
              // confirms an IME candidate, even after React-level
              // isComposing has flipped.
              if (
                e.key !== 'Enter' ||
                isComposing ||
                (e.nativeEvent as KeyboardEvent).isComposing ||
                enterDisabled
              ) {
                return
              }

              // Plain Enter (no modifiers) → submit
              if (!e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
                if (!hasPendingInput) {
                  e.preventDefault()
                  return
                }
                e.preventDefault()
                const textarea = e.target as HTMLTextAreaElement
                textarea.form?.requestSubmit()
                setIsInputFocused(false)
                textarea.blur()
                return
              }

              // Shift+Enter falls through to textarea default (inserts \n).
              // Alt/Option+Enter on macOS does NOT insert \n by default,
              // so insert it manually to match user expectation.
              if (e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                const textarea = e.target as HTMLTextAreaElement
                const start = textarea.selectionStart ?? input.length
                const end = textarea.selectionEnd ?? input.length
                const next = input.slice(0, start) + '\n' + input.slice(end)
                handleInputChange({
                  target: { value: next }
                } as React.ChangeEvent<HTMLTextAreaElement>)
                requestAnimationFrame(() => {
                  textarea.selectionStart = textarea.selectionEnd = start + 1
                })
              }
            }}
          />

          {/* Bottom menu area */}
          <div className="flex items-center justify-between p-2 md:p-3">
            <div className="flex items-center gap-2">
              {!isGuest && (
                <div ref={attachmentMenuRef} className="relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ALLOWED_FILE_TYPES.join(',')}
                    className="hidden"
                    onChange={event => {
                      const files = Array.from(event.target.files ?? [])
                      event.target.value = ''
                      setIsAttachmentMenuOpen(false)
                      void uploadSelectedFiles(files)
                    }}
                  />
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 rounded-full transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:rotate-90 hover:scale-110 active:scale-90"
                          aria-label="Add"
                          aria-expanded={isAttachmentMenuOpen}
                          onClick={() => setIsAttachmentMenuOpen(open => !open)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Add
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {isAttachmentMenuOpen && (
                    <div
                      className={cn(
                        'absolute left-0 z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
                        // When a discussion is open the panel sits at the bottom,
                        // so open the menu upward to keep it in view. On the main
                        // (empty) view keep it opening downward.
                        messages.length > 0 ? 'bottom-full mb-2' : 'top-full mt-2'
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                        onClick={() => {
                          setIsAttachmentMenuOpen(false)
                          fileInputRef.current?.click()
                        }}
                      >
                        <Paperclip className="size-4" />
                        Upload file
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                        onClick={openLibraryPicker}
                      >
                        <LibraryIcon className="size-4" />
                        Add from library
                      </button>
                    </div>
                  )}
                </div>
              )}
              <SearchModeSelector
                isAdaptiveAuthRequired={isAdaptiveAuthRequired}
                onAdaptiveAuthRequired={onAdaptiveModeAuthRequired}
              />
            </div>
              <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleNewChat}
                  className="shrink-0 size-8 md:size-10 rounded-full group"
                  type="button"
                  disabled={isLoading}
                >
                  <MessageCirclePlus className="size-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-110 group-hover:-rotate-6 group-active:scale-95" />
                </Button>
              )}
              <Button
                type={isLoading ? 'button' : 'submit'}
                size={'icon'}
                className={cn(
                  isLoading && 'animate-pulse',
                  'size-8 md:size-10 rounded-full transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:-translate-y-0.5 hover:scale-110 active:scale-95'
                )}
                disabled={
                  (!hasPendingInput && !isLoading) || !hasAvailableModels
                }
                onClick={isLoading ? stop : undefined}
                title={
                  hasAvailableModels
                    ? undefined
                    : 'No enabled model is available'
                }
              >
                {isLoading ? (
                  <Square className="size-4 md:size-5" />
                ) : (
                  <ArrowUp className="size-4 md:size-5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Action buttons for prompt suggestions */}
        {messages.length === 0 && (
          <ActionButtons
            onSelectPrompt={message => {
              // Set the input value and submit
              handleInputChange({
                target: { value: message }
              } as React.ChangeEvent<HTMLTextAreaElement>)
              // Submit the form after a small delay to ensure the input is updated
              setTimeout(() => {
                inputRef.current?.form?.requestSubmit()
                // Reset focus state after action button submission
                setIsInputFocused(false)
                inputRef.current?.blur()
              }, INPUT_UPDATE_DELAY_MS)
            }}
            onCategoryClick={category => {
              // Set the category in the input
              handleInputChange({
                target: { value: category }
              } as React.ChangeEvent<HTMLTextAreaElement>)
              // Focus the input
              inputRef.current?.focus()
            }}
            onAttachImageAndPrompt={(file, prompt) => {
              // Attach the selected photo as a chat file
              uploadSelectedFiles([file])
              // Display the full prompt in the chat input
              handleInputChange({
                target: { value: prompt }
              } as React.ChangeEvent<HTMLTextAreaElement>)
            }}
            isGuest={isGuest}
            inputRef={inputRef}
            className="mt-2"
          />
        )}
      </form>
      <LibraryPickerDialog
        open={isLibraryPickerOpen}
        onOpenChange={setIsLibraryPickerOpen}
        onAttachNote={handleAttachNote}
        onAttachFile={handleAttachLibraryFile}
      />
    </div>
  )
}
