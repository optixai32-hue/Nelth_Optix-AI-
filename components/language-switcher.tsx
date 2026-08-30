'use client'

import { type Locale,locales } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

import { useI18n } from './i18n-provider'

const LABELS: Record<Locale, string> = {
  en: 'EN',
  fr: 'FR'
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Language">
      {locales.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            locale === l
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
