import '@/lib/polyfills'
import type { Metadata, Viewport } from 'next'
import { Inter as FontSans } from 'next/font/google'
import { headers } from 'next/headers'

import { Analytics } from '@vercel/analytics/next'

import {
  getCurrentUser,
  getCurrentUserId,
  toAppUserFromServer
} from '@/lib/auth/get-current-user'
import { UserProvider } from '@/lib/contexts/user-context'
import { hasFirebaseConfig } from '@/lib/firebase/config'
import type { AppUser } from '@/lib/firebase/user'
import { detectLocaleFromHeader } from '@/lib/i18n/config'
import { getModelSelectorData } from '@/lib/model-selector/get-model-selector-data'
import { cn } from '@/lib/utils'

import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'

import AppSidebar from '@/components/app-sidebar'
import ArtifactRoot from '@/components/artifact/artifact-root'
import FloatingAccountMenu from '@/components/floating-account-menu'
import GuestMenu from '@/components/guest-menu'
import Header from '@/components/header'
import { I18nProvider } from '@/components/i18n-provider'
import { KeyboardShortcutHandler } from '@/components/keyboard-shortcut-handler'
import { LibraryProvider } from '@/components/library/library-context'
import { PostHogProvider } from '@/components/posthog-provider'
import SidebarModelSelector from '@/components/sidebar-model-selector'
import { ThemeProvider } from '@/components/theme-provider'
import UserMenu from '@/components/user-menu'

import './globals.css'

const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-sans'
})

const title = 'Nelth-IA'
const description =
  'A fully open-source AI-powered answer engine with a generative UI.'

export const metadata: Metadata = {
  metadataBase: new URL('https://morphic.sh'),
  title,
  description,
  openGraph: {
    title,
    description
  },
  twitter: {
    title,
    description,
    card: 'summary_large_image',
    creator: '@miiura'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  viewportFit: 'cover'
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  let user: AppUser | null = null

  if (hasFirebaseConfig()) {
    const currentUser = await getCurrentUser()
    if (currentUser) {
      user = toAppUserFromServer(currentUser)
    }
  }

  const userId = user?.id ?? (await getCurrentUserId())
  const modelSelectorData = await getModelSelectorData()
  const isCloudDeployment = process.env.MORPHIC_CLOUD_DEPLOYMENT === 'true'

  const acceptLanguage = (await headers()).get('accept-language')
  const locale = detectLocaleFromHeader(acceptLanguage)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={cn(
          'fixed inset-0 flex flex-col font-sans antialiased overflow-hidden overscroll-x-none',
          fontSans.variable
        )}
      >
        <I18nProvider initialLocale={locale}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
          <PostHogProvider userId={user?.id ?? null}>
            <UserProvider hasUser={!!userId}>
                <SidebarProvider defaultOpen={false}>
                  <LibraryProvider>
                    {userId && <AppSidebar user={user} />}
                    <SidebarModelSelector
                      modelSelectorData={modelSelectorData}
                      isCloudDeployment={isCloudDeployment}
                      isGuest={!userId}
                    />
                    <KeyboardShortcutHandler />
                    <div className="flex flex-col flex-1 min-w-0">
                      <Header user={user} />
                      <main className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                        <ArtifactRoot>{children}</ArtifactRoot>
                      </main>
                    </div>
                  </LibraryProvider>
                  {/* Account avatar pinned to the bottom-left of the screen.

                      Visible only when the sidebar is closed so it doesn't
                      overlap the sidebar footer avatar. */}
                  <FloatingAccountMenu user={user} />
                </SidebarProvider>
            </UserProvider>
          </PostHogProvider>
          <Toaster />
          <Analytics />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
