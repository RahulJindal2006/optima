// One small set of line icons, drawn on a 20 by 20 grid.
const PATHS = {
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  x: <path d="M5 5l10 10M15 5L5 15" />,
  'chevron-down': <path d="M5 7.5l5 5 5-5" />,
  'chevron-right': <path d="M7.5 5l5 5-5 5" />,
  'chevron-left': <path d="M12.5 5l-5 5 5 5" />,
  'arrow-left': <path d="M16 10H4M9 5l-5 5 5 5" />,
  'arrow-right': <path d="M4 10h12M11 5l5 5-5 5" />,
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </>
  ),
  bookmark: <path d="M5.5 3.5h9v13L10 13.3l-4.5 3.2z" />,
  mic: (
    <>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="5.5" width="10" height="9" rx="2" />
      <path d="M12.5 9l5-2.5v7l-5-2.5" />
    </>
  ),
  upload: <path d="M10 13V3.5M6 7l4-4 4 4M3.5 13v2.5a1 1 0 001 1h11a1 1 0 001-1V13" />,
  file: <path d="M5.5 2.5h6L15 6v11.5H5.5zM11.5 2.5V6H15" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2" />
    </>
  ),
  pin: (
    <>
      <path d="M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 00-11 0c0 4.500 5.5 9.5 5.5 9.5z" />
      <circle cx="10" cy="8" r="2" />
    </>
  ),
  building: <path d="M4.5 17.5v-14h8v14M12.5 8.500h3v9M2.5 17.5h15M7.5 7h2M7.5 10.5h2M7.5 14h2" />,
  briefcase: (
    <>
      <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
      <path d="M7 6V4.5a1 1 0 011-1h4a1 1 0 011 1V6M2.5 11h15" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7" r="3.5" />
      <path d="M3.5 17a6.500 6.500 0 0113 0" />
    </>
  ),
  edit: <path d="M4 16l.8-3.600 8.700-8.700a1.400 1.400 0 012 0l.8.8a1.400 1.400 0 010 2l-8.700 8.700zM12 5.200l2.800 2.800" />,
  trash: (
    <path d="M4 5.500h12M8 5.500V4a1 1 0 011-1h2a1 1 0 011 1v1.500M5.500 5.500l.7 10a1 1 0 001 .9h5.600a1 1 0 001-.9l.7-10" />
  ),
  external: <path d="M11.500 4H16v4.500M16 4l-7 7M14 11.500V15a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h3.500" />,
  info: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9.200v4.300" />
      <circle cx="10" cy="6.500" r="0.6" fill="currentColor" />
    </>
  ),
  alert: (
    <>
      <path d="M10 3l7.500 13.500h-15z" />
      <path d="M10 8.200v3.300" />
      <circle cx="10" cy="13.900" r="0.6" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V6.500a3 3 0 016 0V9" />
    </>
  ),
  eye: (
    <>
      <path d="M2 10s3-5.500 8-5.500S18 10 18 10s-3 5.500-8 5.500S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.2" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M3 6l7 5 7-5" />
    </>
  ),
  phone: (
    <path d="M6.200 3h2l1 3.500-1.600 1.200a8 8 0 004.700 4.700l1.200-1.600 3.500 1v2a1.700 1.700 0 01-1.900 1.700A12.500 12.500 0 014.500 4.900 1.700 1.700 0 016.200 3z" />
  ),
  link: (
    <path d="M8.500 11.500a3 3 0 004.200 0l2.800-2.800a3 3 0 00-4.200-4.200l-.8.8M11.500 8.500a3 3 0 00-4.200 0l-2.800 2.800a3 3 0 004.200 4.200l.8-.8" />
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.500h14M7 2.500V6M13 2.500V6" />
    </>
  ),
  play: <path d="M7 4.500v11l9-5.500z" />,
  stop: <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />,
  volume: <path d="M3.500 8v4h3l4 3.500v-11l-4 3.500zM13.500 7.500a3.500 3.500 0 010 5M15.500 5a7 7 0 010 10" />,
  code: <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />,
  menu: <path d="M3.500 6h13M3.500 10h13M3.500 14h13" />,
  logout: <path d="M8 3.500H5a1 1 0 00-1 1v11a1 1 0 001 1h3M12.500 13.500L16 10l-3.500-3.500M16 10H8" />,
  filter: (
    <>
      <path d="M3.500 6h8M15.500 6h1M3.500 14h1M8.500 14h8" />
      <circle cx="13.500" cy="6" r="1.800" />
      <circle cx="6.500" cy="14" r="1.800" />
    </>
  ),
}

export default function Icon({ name, size = 20, className, title, ...rest }) {
  const shape = PATHS[name]
  if (!shape) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {shape}
    </svg>
  )
}
