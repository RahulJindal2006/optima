import { SEND_AT } from '../lib/score'

// A score from 0 to 100 on a line, with a mark where an application gets sent.
export default function ScoreLine({ value = 0, at = SEND_AT, moves = false, className = '', label, ...rest }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const fits = v >= at
  return (
    <span
      className={`scoreline ${fits ? 'fits' : ''} ${moves ? 'moves' : ''} ${className}`}
      style={{ '--v': v, '--at': at }}
      role="img"
      aria-label={label || `${Math.round(v)} out of 100. Applications are sent at ${at}.`}
      {...rest}
    >
      <span className="sl-fill" />
      <span className="sl-at" />
      <span className="sl-run">
        <span className="sl-dot" />
      </span>
    </span>
  )
}
