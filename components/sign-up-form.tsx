'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth'

import { establishSession, getFirebaseAuth } from '@/lib/firebase/client'
import { cn } from '@/lib/utils/index'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { IconLogo } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'

import { useI18n } from './i18n-provider'

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const { t } = useI18n()
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError(t('auth.passwordsDoNotMatch'))
      setIsLoading(false)
      return
    }

    try {
      const auth = getFirebaseAuth()
      const cred = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      )
      // Store the name with a space ("First Last") so the greeting can show
      // only the first name via first-word extraction.
      const displayName = `${firstName} ${lastName}`.trim()
      if (displayName) {
        await updateProfile(cred.user, { displayName })
      }
      const idToken = await cred.user.getIdToken()
      await establishSession(idToken)
      router.push('/auth/sign-up-success')
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={cn('flex flex-col items-center gap-6', className)}
      {...props}
    >
      <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl flex flex-col items-center justify-center gap-4">
              <IconLogo className="size-16" />
              {t('auth.createAccount')}
            </CardTitle>
            <CardDescription>
              {t('auth.enterDetails')}
            </CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="first-name">{t('auth.firstName')}</Label>
                  <Input
                    id="first-name"
                    placeholder="Nelcia"
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="last-name">{t('auth.lastName')}</Label>
                  <Input
                    id="last-name"
                    placeholder="Julie"
                    required
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                </div>
                <PasswordInput
                  id="password"
                  type="password"
                  placeholder="********"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">{t('auth.repeatPassword')}</Label>
                </div>
                <PasswordInput
                  id="repeat-password"
                  type="password"
                  placeholder="********"
                  required
                  value={repeatPassword}
                  onChange={e => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('auth.creatingAccount') : t('common.signUp')}
              </Button>
            </div>
            <div className="mt-6 text-center text-sm">
              {t('auth.alreadyHaveAccount')}{' '}
              <Link href="/auth/login" className="underline underline-offset-4">
                {t('common.signIn')}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          &larr; {t('common.backToHome')}
        </Link>
      </div>
    </div>
  )
}
