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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof window==="undefined")return;if(!window.crypto){window.crypto={}}if(!window.crypto.getRandomValues){window.crypto.getRandomValues=function(a){if(!a)return a;var u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);for(var i=0;i<u.length;i++){u[i]=Math.floor(Math.random()*256)}return a}}if(typeof HTMLFormElement!=="undefined"&&!HTMLFormElement.prototype.requestSubmit){HTMLFormElement.prototype.requestSubmit=function(s){if(s&&typeof s.click==="function"){s.click();return}var ev=new CustomEvent("submit",{bubbles:true,cancelable:true});if(this.dispatchEvent(ev)){this.submit()}}}if(!window.queueMicrotask){window.queueMicrotask=function(cb){Promise.resolve().then(cb).catch(function(e){setTimeout(function(){throw e},0)})}}if(!Array.prototype.at){Array.prototype.at=function(n){var len=this.length,k=n>=0?n:len+n;return(k<0||k>=len)?undefined:this[k]}}if(!String.prototype.at){String.prototype.at=function(n){var len=this.length,k=n>=0?n:len+n;return(k<0||k>=len)?"":this.charAt(k)}}if(!Object.hasOwn){Object.hasOwn=function(obj,prop){return Object.prototype.hasOwnProperty.call(obj,prop)}}if(!window.crypto.randomUUID){window.crypto.randomUUID=function(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==="x"?r:(r&3|8);return v.toString(16)})}}if(!window.structuredClone){window.structuredClone=function(obj){return obj===undefined?undefined:JSON.parse(JSON.stringify(obj))}}if(typeof window.ResizeObserver!=="function"){window.ResizeObserver=function(cb){this.observe=function(t){setTimeout(function(){try{cb([{target:t,contentRect:t.getBoundingClientRect()}])}catch(e){}},0)};this.unobserve=function(){};this.disconnect=function(){}}}})();`
          }}
        />
      </head>
      <body
        className={cn(
          'fixed top-0 left-0 right-0 bottom-0 inset-0 w-full h-full min-h-screen flex flex-col font-sans antialiased overflow-hidden overscroll-x-none bg-background text-foreground',
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
