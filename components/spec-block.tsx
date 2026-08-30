'use client'

import { Component, ReactNode, useMemo } from 'react'

import { ActionProvider, JSONUIProvider, Renderer } from '@json-render/react'
import { toast } from 'sonner'

import { captureClient, chatIdFromPath } from '@/lib/analytics/posthog-client'
import { useChatContext } from '@/lib/contexts/chat-context'
import { registry } from '@/lib/render/registry'
import { stripMarkdownLinks } from '@/lib/render/sanitize'
import type { SpecFenceResult } from '@/lib/render/spec-fence'

function currentChatId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return chatIdFromPath(window.location.pathname)
}

type SpecBlockProps = {
  result: SpecFenceResult
}

// Defense-in-depth: a malformed component spec (e.g. emitted by a weaker
// model) can crash @json-render's renderer. Contain that crash here so it
// degrades to a message instead of white-screening the whole chat.
class SpecErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Ce composant n&apos;a pas pu être affiché (spécification invalide).
        </div>
      )
    }
    return this.props.children
  }
}

export function SpecBlock({ result }: SpecBlockProps) {
  const chatContext = useChatContext()

  const handlers = useMemo(
    () => ({
      submitQuery: (params: Record<string, unknown>) => {
        const rawQuery = (params as { query?: string }).query
        const query = typeof rawQuery === 'string' ? stripMarkdownLinks(rawQuery) : ''
        if (!query.trim()) return

        // Reject clicks while a response is in flight. Firing a second
        // sendMessage mid-stream corrupts useChat's internal state and
        // leaves the input box stuck disabled. Read via the ref so the
        // frozen closure (ActionProvider stores handlers as
        // useState(initialHandlers)) still sees the latest value.
        if (chatContext.isStreamingRef.current) {
          toast.info('Please wait for the current response to finish.')
          return
        }

        captureClient('related_question_clicked', { chatId: currentChatId() })

        chatContext.sendMessage({
          role: 'user',
          parts: [{ type: 'text', text: query }]
        })
      }
    }),
    [chatContext]
  )

  const content = useMemo(() => {
    if (result.status !== 'ready') {
      return null
    }

    if (!result.spec.root || !result.spec.elements) {
      return null
    }

    return (
      <div className="pt-2 pb-4">
        <JSONUIProvider registry={registry} initialState={result.spec.state}>
          <ActionProvider handlers={handlers}>
            <SpecErrorBoundary>
              <Renderer spec={result.spec} registry={registry} />
            </SpecErrorBoundary>
          </ActionProvider>
        </JSONUIProvider>
      </div>
    )
  }, [result, handlers])

  return content
}
