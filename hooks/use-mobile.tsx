import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const isAndroidPhone =
      /Android/i.test(navigator.userAgent) &&
      window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.innerWidth, window.innerHeight) < 600
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT || isAndroidPhone)
    }
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
    } else if (typeof (mql as any).addListener === 'function') {
      ;(mql as any).addListener(onChange)
    }
    onChange()
    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onChange)
      } else if (typeof (mql as any).removeListener === 'function') {
        ;(mql as any).removeListener(onChange)
      }
    }
  }, [])

  return !!isMobile
}
