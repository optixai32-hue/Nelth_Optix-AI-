'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  IconLink as Link2,
  IconLogout as LogOut,
  IconUserCircle as UserRound
} from '@tabler/icons-react'
import { signOut } from 'firebase/auth'

import { clearSession, getFirebaseAuth } from '@/lib/firebase/client'
import type { AppUser } from '@/lib/firebase/user'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import { AccountSettingsDialog } from '@/components/account-settings-dialog'

import { Button } from './ui/button'
import { ExternalLinkItems } from './external-link-items'

interface UserMenuProps {
  user: AppUser
}

export default function UserMenu({ user }: UserMenuProps) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const userName = user.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.image

  const getInitials = (name: string, email: string | undefined) => {
    if (name && name !== 'User') {
      const names = name.split(' ')
      if (names.length > 1) {
        return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
      }
      return name.substring(0, 2).toUpperCase()
    }
    if (email) {
      return email.split('@')[0].substring(0, 2).toUpperCase()
    }
    return 'U'
  }

  const handleLogout = async () => {
    try {
      await signOut(getFirebaseAuth())
    } catch {
      // ignore
    }
    await clearSession().catch(() => {})
    router.push('/')
    router.refresh()
  }

  const handleOpenAccount = () => {
    setMenuOpen(false)
    window.setTimeout(() => setAccountOpen(true), 0)
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative size-6 rounded-full">
            <Avatar className="size-6 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-110 active:scale-95">
              <AvatarImage src={avatarUrl ?? undefined} alt={userName} />
              <AvatarFallback>
                {getInitials(userName, user.email ?? undefined)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none truncate">
                {userName}
              </p>
              <p className="text-xs leading-none text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              handleOpenAccount()
            }}
          >
            <UserRound className="size-4" />
            <span>Account</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Link2 className="size-4" />
              <span>Links</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <ExternalLinkItems />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="size-4" />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountSettingsDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        user={user}
      />
    </>
  )
}
