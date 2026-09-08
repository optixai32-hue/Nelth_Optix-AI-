'use client'

import { cn } from '@/lib/utils'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'

interface StepsRootProps extends React.ComponentProps<typeof Collapsible> {
  children: React.ReactNode
  className?: string
  defaultOpen?: boolean
}

export function Steps({
  children,
  className,
  defaultOpen = true,
  ...props
}: StepsRootProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn('rounded-lg border bg-card/50', className)}
      {...props}
    >
      {children}
    </Collapsible>
  )
}

export const StepsRoot = Steps

interface StepsTriggerProps
  extends React.ComponentProps<typeof CollapsibleTrigger> {
  children: React.ReactNode
  leftIcon?: React.ReactNode
  swapIconOnHover?: boolean
  className?: string
}

export function StepsTrigger({
  children,
  leftIcon,
  swapIconOnHover = true,
  className,
  ...props
}: StepsTriggerProps) {
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

interface StepsContentProps
  extends React.ComponentProps<typeof CollapsibleContent> {
  children: React.ReactNode
  className?: string
  bar?: React.ReactNode
}

export function StepsContent({
  children,
  className,
  bar = <StepsBar />,
  ...props
}: StepsContentProps) {
  return (
    <CollapsibleContent
      className={cn('overflow-hidden text-sm', className)}
      {...props}
    >
      <div className="flex border-t">
        {bar}
        <div className="min-w-0 flex-1 space-y-1 px-3 py-2">{children}</div>
      </div>
    </CollapsibleContent>
  )
}

interface StepsBarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function StepsBar({ className }: StepsBarProps) {
  return (
    <div className={cn('bg-muted h-full w-[2px]', className)} aria-hidden />
  )
}

interface StepsItemProps extends React.ComponentProps<'div'> {
  children: React.ReactNode
  className?: string
}

export function StepsItem({ children, className, ...props }: StepsItemProps) {
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
