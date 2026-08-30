'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { IconLogo } from '@/components/ui/icons'

import { useI18n } from './i18n-provider'

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-muted">
            <IconLogo className="size-14" />
          </div>
          <DialogTitle className="text-xl font-semibold">
            {t('common.continueWith')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('common.toUse')}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6 space-y-3">
          <Button asChild className="w-full" size="lg">
            <Link href="/auth/sign-up">{t('common.signUp')}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full" size="lg">
            <Link href="/auth/login">{t('common.signIn')}</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
