import { PARTS, percent, whole } from '../lib/score'

// The four parts of a match score. `values` follows the order of PARTS.
// `painted` lets the landing page drive the bars from scroll (see lib/paint.js).
export default function ScoreParts({ values, className = '', painted = false }) {
  return (
    <ul className={`parts ${className}`}>
      {PARTS.map((part, i) => {
        const v = whole(values?.[i]) ?? 0
        const drive = painted ? { 'data-to': v, 'data-d': (i * 0.08).toFixed(2) } : null
        return (
          <li className="part" key={part.key}>
            <span className="part-name">
              {part.label}
              <small>{percent(part.weight)}</small>
            </span>
            <span className="part-value" {...(painted ? { 'data-paint': 'count', ...drive } : null)}>
              {v}
            </span>
            <span className="part-bar" aria-hidden="true">
              <i style={{ '--v': v }} {...(painted ? { 'data-paint': 'grow', ...drive } : null)} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
