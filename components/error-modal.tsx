'use client'

import Link from 'next/link'

import {
  IconAlertCircle as AlertCircle,
  IconClock as Clock,
  IconRefresh as RefreshCw
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

import { useI18n } from './i18n-provider'

interface ErrorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  error: {
    type: 'rate-limit' | 'auth' | 'forbidden' | 'general'
    message: string
    details?: string
  }
  onRetry?: () => void
  onAuthClose?: () => void
}

export function ErrorModal({
  open,
  onOpenChange,
  error,
  onRetry,
  onAuthClose
}: ErrorModalProps) {
  const { t } = useI18n()
  const handleAuthClose = () => {
    onOpenChange(false)
    onAuthClose?.()
  }

  const getErrorIcon = () => {
    switch (error.type) {
      case 'rate-limit':
        return <Clock className="size-6 text-yellow-500" />
      case 'auth':
      case 'forbidden':
        return <AlertCircle className="size-6 text-red-500" />
      default:
        return <AlertCircle className="size-6 text-orange-500" />
    }
  }

  const getErrorTitle = () => {
    switch (error.type) {
      case 'rate-limit':
        return t('error.rateLimit')
      case 'auth':
        return t('common.continueWith')
      case 'forbidden':
        return t('error.accessDenied')
      default:
        return t('error.errorOccurred')
    }
  }

  const getErrorDescription = () => {
    switch (error.type) {
      case 'rate-limit':
        return error.message || t('error.tooManyRequests')
      case 'auth':
        return error.message || t('error.authRequired')
      case 'forbidden':
        return t('error.forbidden')
      default:
        return error.message || t('error.unexpected')
    }
  }

  const getErrorDetails = () => {
    if (error.type === 'rate-limit') {
      return error.details || t('error.limitResets')
    }
    return error.details
  }

  return (
    <Dialog
      open={open}
      onOpenChange={open => {
        if (!open && error.type === 'auth') {
          handleAuthClose()
        } else {
          onOpenChange(open)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            {getErrorIcon()}
          </div>
          <DialogTitle className="text-center text-xl font-semibold">
            {getErrorTitle()}
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground">
            {getErrorDescription()}
          </DialogDescription>
          {getErrorDetails() && (
            <div className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              {getErrorDetails()}
            </div>
          )}
        </DialogHeader>
        <DialogFooter className="flex-col gap-2">
          {error.type === 'auth' ? (
            <>
              <Button asChild className="w-full">
                <Link href="/auth/sign-up">{t('common.signUp')}</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/auth/login">{t('common.signIn')}</Link>
              </Button>
            </>
          ) : (
            <>
              {onRetry && error.type !== 'rate-limit' && (
                <Button
                  onClick={() => {
                    onRetry()
                    onOpenChange(false)
                  }}
                  className="w-full"
                >
                  <RefreshCw className="mr-2 size-4" />
                  {t('common.tryAgain')}
                </Button>
              )}
              <Button
                variant={
                  onRetry && error.type !== 'rate-limit' ? 'outline' : 'default'
                }
                onClick={() => onOpenChange(false)}
                className="w-full"
              >
                {error.type === 'rate-limit'
                  ? t('common.understood')
                  : t('common.close')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
