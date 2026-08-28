'use client'

// import Link from 'next/link' // No longer needed directly here for Sign In button
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { SquarePen } from 'lucide-react'

import type { AppUser } from '@/lib/firebase/user'
import { cn } from '@/lib/utils'
import { SHORTCUT_EVENTS } from '@/lib/keyboard-shortcuts'

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Button } from './ui/button'
import { useIsMobile } from '@/hooks/use-mobile'

interface HeaderProps {
  user: AppUser | null
}

export const Header: React.FC<HeaderProps> = ({ user }) => {
  const router = useRouter()
  const { open } = useSidebar()
  const isMobile = useIsMobile()

  const handleNewChat = () => {
    window.dispatchEvent(
      new CustomEvent(SHORTCUT_EVENTS.newChat, { cancelable: true })
    )
    router.push('/')
  }

  return (
    <>
      <header
        className={cn(
          'absolute top-0 right-0 p-2 md:p-3 flex justify-between items-center z-10 backdrop-blur-sm lg:backdrop-blur-none bg-background/80 lg:bg-transparent transition-[width] duration-200 ease-linear',
          open ? 'md:w-[calc(100%-var(--sidebar-width))]' : 'md:w-full',
          'w-full'
        )}
      >
        {/* Mobile only: sidebar toggle (close icon) + divider + New chat
            button, aligned horizontally at the header left. */}
        {isMobile && user && (
          <div className="flex flex-row items-center gap-1 rounded-full bg-background/95 px-1.5 py-1 text-foreground shadow-[0_6px_16px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] ring-1 ring-border/80">
            <SidebarTrigger className="size-5 text-foreground transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:rotate-90 active:scale-90" />
            <div className="w-px h-5 bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-foreground transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 hover:-rotate-6 active:scale-95"
              aria-label="New chat"
              title="New chat"
              onClick={handleNewChat}
            >
              <SquarePen size={16} />
            </Button>
          </div>
        )}

        {isMobile && !user && (
          <Link
            href="/auth/login"
            className="mobile-login-pulse rounded-full bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-[0_6px_16px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] ring-1 ring-border/80"
          >
            Se connecter
          </Link>
        )}

        {/* Desktop only: when the sidebar is collapsed, show the small trigger
            (SidebarIcon) with the New chat button stacked below it, pushed
            just under the top bar on the left. */}
        {!isMobile && !open && user && (
          <div className="absolute left-3 top-12 flex flex-col items-center gap-1">
            <div className="w-px h-5 bg-border" aria-hidden />
            <SidebarTrigger className="size-5 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:rotate-90 active:scale-90" />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 hover:-rotate-6 active:scale-95"
              aria-label="New chat"
              title="New chat"
              onClick={handleNewChat}
            >
              <SquarePen size={16} />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Account avatar moved to the bottom-left of the sidebar (AppSidebar). */}
        </div>
      </header>
    </>
  )
}

export default Header
