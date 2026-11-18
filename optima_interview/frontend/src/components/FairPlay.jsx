import { cameraLine, fairPlayLines } from '../lib/fairplay'
import { plural } from '../lib/format'
import Icon from './Icon'

// How a weekly interview was taken. `record` is null for interviews from before these checks existed.
//   compact: one line, for a list
export default function FairPlay({ record, compact = false, missing = 'No record. This interview was taken before fair-play checks were added.' }) {
  if (!record) return compact ? null : <p className="muted fairplay-none">{missing}</p>

  if (record.clean) {
    return (
      <p className={`fairplay clean ${compact ? 'compact' : ''}`}>
        <Icon name="check" size={18} />
        <span>
          {compact
            ? 'Clean interview'
            : `Stayed in the interview window from start to finish. No paste attempts.${cameraLine(record) ? ` ${cameraLine(record)}` : ''}`}
        </span>
      </p>
    )
  }

  const lines = fairPlayLines(record)
  if (compact) {
    return (
      <p className="fairplay compact flagged">
        <Icon name="alert" size={18} />
        <span>{plural(lines.length, 'note')} on how it was taken</span>
      </p>
    )
  }
  return (
    <ul className="fairplay-list">
      {lines.map((line) => (
        <li key={line}>
          <Icon name="alert" size={18} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}
