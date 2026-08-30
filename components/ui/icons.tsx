'use client'

import { cn } from '@/lib/utils'

import { NelthLogo } from './nelth-logo'

function IconLogo({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <NelthLogo
      variant="idle"
      className={cn('text-foreground dark:text-white', className)}
      {...props}
    />
  )
}

function IconLogoOutline({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <NelthLogo
      variant="idle"
      className={cn('text-foreground dark:text-white', className)}
      {...props}
    />
  )
}

function IconBlinkingLogo({
  className,
  ...props
}: React.ComponentProps<'svg'>) {
  return <NelthLogo variant="idle" className={className} {...props} />
}

export { IconBlinkingLogo, IconLogo, IconLogoOutline }
