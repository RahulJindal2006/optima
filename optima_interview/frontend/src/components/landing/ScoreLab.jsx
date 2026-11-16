import { useState } from 'react'
import ScoreLine from '../ScoreLine'
import { PARTS, SEND_AT, composite, percent } from '../../lib/score'
import '../../styles/lab.css'

const PRESETS = [
  { label: 'A strong example', values: [91, 88, 80, 78] },
  { label: 'Same answers, no resume', values: [91, 88, 80, 0] },
  { label: 'Same answers, empty profile', values: [91, 88, 0, 0] },
]

const same = (a, b) => a.every((v, i) => v === b[i])

// Four sliders, one score. The same sum the backend asks Claude to make.
export default function ScoreLab({ title = 'Nothing hidden in the score.', lead = 'A match score is four parts, weighted and added up. Move them and watch where you land.', Heading = 'h2' }) {
  const [values, setValues] = useState(PRESETS[0].values)
  const exact = composite(values)
  const score = Math.round(exact)
  const sent = score >= SEND_AT
  const gap = Math.abs(score - SEND_AT)

  const set = (i, v) => setValues((old) => old.map((x, j) => (j === i ? v : x)))

  return (
    <div className="lab">
      <div className="lab-left">
        <Heading>{title}</Heading>
        <p className="lead">{lead}</p>

        <div className="lab-controls">
          {PARTS.map((part, i) => (
            <div className="slider" key={part.key}>
              <label htmlFor={`lab-${part.key}`}>
                <span>
                  {part.label}
                  <small>{percent(part.weight)}</small>
                </span>
                <output htmlFor={`lab-${part.key}`}>{values[i]}</output>
              </label>
              <input
                id={`lab-${part.key}`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={values[i]}
                style={{ '--v': values[i] }}
                onChange={(e) => set(i, Number(e.target.value))}
                aria-describedby={`lab-note-${part.key}`}
              />
              <p className="hint" id={`lab-note-${part.key}`}>
                {part.note}
              </p>
            </div>
          ))}

          <div className="lab-presets" role="group" aria-label="Try an example">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                className="btn secondary sm"
                aria-pressed={same(values, p.values)}
                onClick={() => setValues(p.values)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="lab-note">
            An empty profile costs you. With no skills listed, or no resume uploaded, that part of the score is zero.
          </p>
        </div>
      </div>

      <div className="stage lab-out" aria-live="polite">
        <p className="lab-score">
          <span className="sr-only">Match score </span>
          {score}
        </p>
        <p className={`lab-state ${sent ? 'sent' : ''}`}>
          {sent
            ? gap === 0
              ? 'Sent. Right on the line.'
              : `Sent. ${gap} above the line.`
            : `Not sent. ${gap} short of the line.`}
        </p>
        <div className="lab-line">
          <ScoreLine value={exact} moves label={`${score} out of 100`} />
          <div className="lab-scale" aria-hidden="true">
            <i>0</i>
            <i className="at" style={{ left: `${SEND_AT}%` }}>
              {SEND_AT}
            </i>
            <i style={{ left: '100%' }}>100</i>
          </div>
        </div>
        <p className="match-sum" aria-hidden="true">
          {PARTS.map((p, i) => `${p.weight.toFixed(2)} × ${values[i]}`).join(' + ')} = <b>{exact.toFixed(1)}</b>
        </p>
      </div>
    </div>
  )
}
