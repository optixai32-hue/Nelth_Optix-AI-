'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { IconPlus as Plus } from '@tabler/icons-react'

import { SHORTCUT_EVENTS } from '@/lib/keyboard-shortcuts'

import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

import { useI18n } from '../i18n-provider'

export function NewChatMenuItem() {
  const router = useRouter()
  const { t } = useI18n()

  const handleNewChat = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    // Signal ChatPanel to reset its state (same handler as the new-chat
    // keyboard shortcut and the in-panel new-chat button).
    window.dispatchEvent(
      new CustomEvent(SHORTCUT_EVENTS.newChat, { cancelable: true })
    )
    router.push('/')
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={handleNewChat}
        >
          <Plus className="size-4 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 hover:rotate-90 active:scale-95" />
          <span>{t('common.newChat')}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
