'use client'

import { cn } from '@/lib/utils'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'

interface ChainOfThoughtProps {
  children: React.ReactNode
  className?: string
}

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>
}

interface ChainOfThoughtStepProps
  extends React.ComponentProps<typeof Collapsible> {
  children: React.ReactNode
  className?: string
  isLast?: boolean
}

export function ChainOfThoughtStep({
  children,
  className,
  isLast = false,
  ...props
}: ChainOfThoughtStepProps) {
  return (
    <Collapsible
      defaultOpen
      className={cn(
        'rounded-lg border bg-card/50',
        !isLast && 'mb-0',
        className
      )}
      {...props}
    >
      {children}
    </Collapsible>
  )
}

interface ChainOfThoughtTriggerProps
  extends React.ComponentProps<typeof CollapsibleTrigger> {
  children: React.ReactNode
  leftIcon?: React.ReactNode
  swapIconOnHover?: boolean
  className?: string
}

export function ChainOfThoughtTrigger({
  children,
  leftIcon,
  swapIconOnHover = true,
  className,
  ...props
}: ChainOfThoughtTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground/90 hover:bg-muted/40',
        className
      )}
      {...props}
    >
      {leftIcon ? (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {leftIcon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <svg
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </CollapsibleTrigger>
  )
}

interface ChainOfThoughtContentProps
  extends React.ComponentProps<typeof CollapsibleContent> {
  children: React.ReactNode
  className?: string
}

export function ChainOfThoughtContent({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) {
  return (
    <CollapsibleContent
      className={cn('overflow-hidden text-sm', className)}
      {...props}
    >
      <div className="space-y-1 border-t px-3 py-2">{children}</div>
    </CollapsibleContent>
  )
}

interface ChainOfThoughtItemProps extends React.ComponentProps<'div'> {
  children: React.ReactNode
  className?: string
}

export function ChainOfThoughtItem({
  children,
  className,
  ...props
}: ChainOfThoughtItemProps) {
  return (
    <div
      className={cn(
        'flex gap-2 text-muted-foreground [&_strong]:text-foreground/90',
        className
      )}
      {...props}
    >
      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
