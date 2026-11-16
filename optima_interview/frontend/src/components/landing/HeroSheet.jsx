import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import ScoreLine from '../ScoreLine'
import ScoreParts from '../ScoreParts'
import { SEND_AT } from '../../lib/score'
import { paint, play } from '../../lib/paint'
import useMedia from '../../lib/useMedia'
import { ROLES } from './sample'

// One interview, scored against four roles. Rows open to show how each score was built.
export default function HeroSheet() {
  const root = useRef(null)
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const [open, setOpen] = useState(null)
  const [played, setPlayed] = useState(false)
  const settled = still || played

  // Before the first paint: start from zero, unless less motion was asked for.
  useLayoutEffect(() => {
    paint(root.current, still ? 1 : 0)
  }, [still])

  useEffect(() => {
    if (still) return undefined
    let cancel = () => {}
    const timer = setTimeout(() => {
      cancel = play(root.current, 1600, () => setPlayed(true))
    }, 450)
    return () => {
      clearTimeout(timer)
      cancel()
    }
  }, [still])

  return (
    <div className="sheet hero-sheet" ref={root}>
      <div className="sheet-axis" aria-hidden="true">
        <span className="sheet-scale">
          <i>0</i>
          <i className="at" style={{ left: `${SEND_AT}%` }}>
            {SEND_AT}
          </i>
          <i style={{ left: '100%' }}>100</i>
        </span>
      </div>
      <ul className="sheet-rows">
        {ROLES.map((r, i) => {
          const sent = r.score >= SEND_AT
          const isOpen = open === i
          const delay = (i * 0.07).toFixed(2)
          return (
            <li key={r.role} className={`sheet-row ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="sheet-main"
                aria-expanded={isOpen}
                aria-controls={`hero-parts-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="sheet-who">
                  <strong>{r.role}</strong>
                  <span>{r.company}</span>
                </span>
                <span className="sheet-track">
                  <ScoreLine
                    value={r.score}
                    data-paint="line"
                    data-to={r.score}
                    data-d={delay}
                    label={`${r.score} out of 100`}
                  />
                </span>
                <span className="sheet-score" data-paint="count" data-to={r.score} data-d={delay}>
                  {r.score}
                </span>
                <span
                  className={`sheet-state fade ${sent ? 'sent' : ''}`}
                  data-paint="show"
                  data-d={delay}
                  data-at={sent ? (SEND_AT / r.score).toFixed(2) : '0.98'}
                >
                  {sent ? (
                    <>
                      <Icon name="check" size={16} />
                      Sent
                    </>
                  ) : (
                    'Not sent'
                  )}
                </span>
                <Icon name="chevron-down" size={18} className="sheet-chev" />
              </button>
              <div className="sheet-more" id={`hero-parts-${i}`} inert={!isOpen}>
                <div>
                  <div className="sheet-more-in hero-parts">
                    <ScoreParts values={r.parts} />
                    <p className="hero-parts-note">
                      {sent
                        ? `The four parts add up to ${r.score}. That is ${r.score - SEND_AT} above the line, so the application went to ${r.company}.`
                        : `The four parts add up to ${r.score}. That is ${SEND_AT - r.score} short of the line, so nothing was sent.`}
                    </p>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="sheet-note">
        <span>Example data. A score of {SEND_AT} or more sends the application.</span>
        <span className={`sheet-hint ${settled ? 'on' : ''}`}>Select a role to see how its score was built.</span>
      </p>
    </div>
  )
}
