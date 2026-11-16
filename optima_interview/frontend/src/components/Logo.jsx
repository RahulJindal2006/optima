// The mark is the score line: a scale, the line at 40, and a result past it.
export function Mark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="6.5" fill="currentColor" />
      <path d="M5 12.5h14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <path d="M9.8 8.500v8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15.300" cy="12.500" r="2.700" fill="#fff" />
    </svg>
  )
}

export default function Logo({ size = 24 }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="logo-word">Optima</span>
    </span>
  )
}
