import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'sparkles'
  | 'calendar'
  | 'grid'
  | 'inbox'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'cloud'
  | 'cloud-off'
  | 'image'
  | 'arrow-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'copy'
  | 'download'
  | 'x'
  | 'plus'
  | 'minus'
  | 'square'
  | 'pin'
  | 'clock'
  | 'alert'
  | 'github'
  | 'lock'
  | 'json'
  | 'refresh'
  | 'trash'
  | 'arrow-right'
  | 'menu'
  | 'wand'
  | 'external'
  | 'keyboard'

const paths: Record<IconName, ReactNode> = {
  sparkles: (
    <>
      <path d="M12 3.5l1.35 3.9L17.2 8.8l-3.85 1.35L12 14l-1.35-3.85L6.8 8.8l3.85-1.4L12 3.5z" />
      <path d="M18.2 14.4l.72 2.05 2.08.72-2.08.72-.72 2.06-.72-2.06-2.08-.72 2.08-.72.72-2.05z" />
      <path d="M5.2 14.8l.52 1.48 1.5.52-1.5.52-.52 1.48-.52-1.48-1.5-.52 1.5-.52.52-1.48z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
      <path d="M8 13h3M8 16.5h6.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="4" width="7" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5.5h16l1.5 9.5H15l-1.2 2.2h-3.6L9 15H2.5L4 5.5z" />
      <path d="M2.5 15v3.5h19V15" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 13.6a7.7 7.7 0 000-3.2l2-1.4-2-3.4-2.3 1a7.7 7.7 0 00-2.8-1.6L13.6 2h-3.2L10 4.9a7.7 7.7 0 00-2.8 1.6l-2.3-1-2 3.4 2 1.4a7.7 7.7 0 000 3.2l-2 1.4 2 3.4 2.3-1a7.7 7.7 0 002.8 1.6l.4 2.9h3.2l.4-2.9a7.7 7.7 0 002.8-1.6l2.3 1 2-3.4-2-1.4z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.6A8.2 8.2 0 019.4 4a8.3 8.3 0 1010.6 10.6z" />,
  cloud: (
    <path d="M7 18.5h10.2a3.8 3.8 0 00.6-7.6A5.7 5.7 0 007 9.8a4.4 4.4 0 000 8.7z" />
  ),
  'cloud-off': (
    <>
      <path d="M7 18.5h10.2a3.8 3.8 0 001.2-7.4M14.8 7.9A5.7 5.7 0 006.7 10a4.4 4.4 0 00-.4 7.5" />
      <path d="M4 4l16 16" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l4.7-4.4 3.3 3 2.6-2.2L20 18" />
    </>
  ),
  'arrow-up': <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  check: <path d="M4.5 12.5l5 5L20 6.5" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" />
    </>
  ),
  download: <path d="M12 3.5v12M7 10.5l5 5 5-5M4 20.5h16" />,
  x: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  minus: <path d="M4.5 12h15" />,
  square: <rect x="5" y="5" width="14" height="14" rx="1.2" />,
  pin: (
    <>
      <path d="M12 21s6.5-5.4 6.5-10.5a6.5 6.5 0 10-13 0C5.5 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.2" r="2.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5L21 20H3L12 3.5z" />
      <path d="M12 9v4.8M12 17.2v.2" />
    </>
  ),
  github: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.48 0-.24-.01-1.03-.01-1.87-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 015 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .26.18.59.69.48A10.02 10.02 0 0022 12.23C22 6.58 17.52 2 12 2z"
    />
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7.5a4 4 0 018 0V10" />
    </>
  ),
  json: (
    <>
      <path d="M9 4.5c-2.2 0-2.3 1.4-2.3 3.2 0 2.2-.6 3.5-2.7 4.3 2.1.8 2.7 2.1 2.7 4.3 0 1.8.1 3.2 2.3 3.2M15 4.5c2.2 0 2.3 1.4 2.3 3.2 0 2.2.6 3.5 2.7 4.3-2.1.8-2.7 2.1-2.7 4.3 0 1.8-.1 3.2-2.3 3.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-2.1 6.4M20 4v7h-7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 3.5h5M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M14 6.5l5.5 5.5-5.5 5.5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  wand: (
    <>
      <path d="M4 20L15 9M13 5l1.2 2.8L17 9l-2.8 1.2L13 13l-1.2-2.8L9 9l2.8-1.2L13 5z" />
      <path d="M19 14l.7 1.6 1.6.7-1.6.7L19 19l-.7-1.7-1.6-.7 1.6-.7L19 14z" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-8 8M18 14v5H5V6h5" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M7.5 16.5h9" />
    </>
  ),
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="7.2" stroke="currentColor" strokeWidth="1.1" opacity="0.38" />
      <path d="M16 3.5v25" stroke="currentColor" strokeWidth="1.1" opacity="0.2" />
      <circle cx="16" cy="16" r="3.1" fill="currentColor" />
      <path d="M6.5 22.8h19" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
    </svg>
  )
}
