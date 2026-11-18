import { LEVELS, LEVEL_NAME, MARK_NAME } from '../lib/score'
import Icon from './Icon'

// 7.5 stays 7.5, 15.0 becomes 15.
const points = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)))

// A level as a word, with four pips that fill from the left: none 0, weak 1, partial 2, solid 3, strong 4.
export function Level({ level }) {
  const reached = LEVELS.indexOf(level)
  return (
    <span className={`level ${level}`}>
      <span className="pips" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= reached ? 'on' : ''} />
        ))}
      </span>
      {LEVEL_NAME[level] || level}
    </span>
  )
}

// How one answer was scored: every line of the scorecard, the level it reached, and what it added.
// `rubric` is what the server sends with a graded question. The lines add up to the answer's score.
export default function Scorecard({ rubric, showPoints = true }) {
  const lines = rubric?.lines || []
  if (lines.length === 0) return null

  return (
    <div className="card">
      <ul className="card-lines">
        {lines.map((line) => (
          <li className="card-line" key={line.key}>
            <div className="card-what">
              <strong>{line.label}</strong>
              {line.points ? (
                <span>
                  {line.covered} of {line.of} covered{line.partly > 0 && `, ${line.partly} in part`}
                </span>
              ) : (
                <span>{line.meaning}</span>
              )}
            </div>
            <div className="card-level">{line.level && <Level level={line.level} />}</div>
            <p className="card-points">
              <b>{points(line.earned)}</b> of {points(line.worth)}
            </p>
            {line.points && showPoints && (
              <ul className="points card-list">
                {line.points.map((point, i) => (
                  <li className={point.mark === 'covered' ? 'hit' : point.mark === 'partly' ? 'part' : 'missed'} key={`${point.text}-${i}`}>
                    <Icon name={point.mark === 'covered' ? 'check' : 'minus'} size={18} />
                    <span>
                      {point.text}
                      <em>{MARK_NAME[point.mark]}</em>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {rubric.cap === 'weak' && (
        <p className="card-note">
          It stayed on the subject without answering what was asked, so it could not score above 35 however well it was put.
        </p>
      )}
      {rubric.cap === 'none' && <p className="card-note">It did not answer the question that was asked, so nothing else could count.</p>}

      {(rubric.strength || rubric.improve) && rubric.cap !== 'none' && (
        <dl className="card-words">
          {rubric.strength && (
            <div>
              <dt>What worked</dt>
              <dd>{rubric.strength}</dd>
            </div>
          )}
          {rubric.improve && (
            <div>
              <dt>What would raise it</dt>
              <dd>{rubric.improve}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
