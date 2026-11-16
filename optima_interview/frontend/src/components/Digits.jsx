// Figures that change in place (timers, counters) without the text around them jumping.
// The typeface's own tabular figures are a different, technical-looking design, so each
// character gets a fixed cell instead.
export default function Digits({ value, className = '' }) {
  const text = String(value)
  return (
    <span className={`digits ${className}`} aria-label={text} role="text">
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span className="d" key={i} aria-hidden="true">
            {ch}
          </span>
        ) : (
          <span key={i} aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  )
}
