'use client'

/**
 * Minimal brand-style service icons for the Connector Card.
 * Hand-drawn geometric approximations (no external assets) with the
 * services' signature colors, sized via className (default 48px).
 */

function Base({
  children,
  className = 'size-12'
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function GoogleDriveIcon({ className = 'size-12' }: { className?: string }) {
  return (
    <Base className={className}>
      <path
        d="M8.2 3.5 2.8 13.2a1 1 0 0 0 .9 1.5h3.1a1 1 0 0 0 .9-.6L12.4 4a1 1 0 0 0-.9-1.5H9a1 1 0 0 0-.8 1Z"
        fill="#0F9D58"
      />
      <path
        d="M15.8 3.5H11.5a1 1 0 0 0-.9 1.5l4.7 9.1a1 1 0 0 0 .9.6h3.1a1 1 0 0 0 .9-1.5L16.7 4a1 1 0 0 0-.9-.5Z"
        fill="#FFCF40"
      />
      <path
        d="M7.7 15.7H3.7a1 1 0 0 0-.9 1.5l1.6 2.8a1 1 0 0 0 .9.5h13.4a1 1 0 0 0 .9-.5l1.6-2.8a1 1 0 0 0-.9-1.5H8.6a1 1 0 0 0-.9 0Z"
        fill="#2684FC"
      />
    </Base>
  )
}

export function GmailIcon({ className = 'size-12' }: { className?: string }) {
  return (
    <Base className={className}>
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="2.5"
        fill="#fff"
        stroke="#DADCE0"
        strokeWidth="1.4"
      />
      <path
        d="M4 7.5 12 13.5 20 7.5"
        fill="none"
        stroke="#EA4335"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16.5 9.5 12M20 16.5 14.5 12"
        stroke="#188038"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4 7.5V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v.5"
        fill="none"
        stroke="#1A73E8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </Base>
  )
}

export function GoogleCalendarIcon({
  className = 'size-12'
}: {
  className?: string
}) {
  return (
    <Base className={className}>
      <rect
        x="3"
        y="4.5"
        width="18"
        height="16"
        rx="3"
        fill="#fff"
        stroke="#DADCE0"
        strokeWidth="1.4"
      />
      <path
        d="M3 7.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V10H3V7.5Z"
        fill="#1A73E8"
      />
      <path
        d="M8 2.8v3.4M16 2.8v3.4"
        stroke="#1A73E8"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="9" cy="14.5" r="1.4" fill="#1A73E8" />
      <circle cx="13" cy="14.5" r="1.4" fill="#EA4335" />
      <circle cx="17" cy="14.5" r="1.4" fill="#FBBC04" />
      <circle cx="9" cy="17.8" r="1.4" fill="#34A853" />
      <circle cx="13" cy="17.8" r="1.4" fill="#DADCE0" />
    </Base>
  )
}

export function GitHubIcon({ className = 'size-12' }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#171515" />
      <g
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <circle cx="12" cy="8" r="2.2" />
        <circle cx="7.5" cy="15" r="2.2" />
        <circle cx="16.5" cy="15" r="2.2" />
        <path d="M12 10.2v2.3M12 12.5 8.6 14M12 12.5l3.4 1.5" />
      </g>
    </Base>
  )
}

export function NotionIcon({ className = 'size-12' }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#fff" />
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="5"
        fill="none"
        stroke="#111"
        strokeWidth="1.6"
      />
      <path
        d="M8 17.5v-11l8 11v-11"
        fill="none"
        stroke="#111"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Base>
  )
}
