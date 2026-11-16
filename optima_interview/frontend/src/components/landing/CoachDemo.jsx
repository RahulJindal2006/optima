import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { statusLines, tipText } from '../../lib/coach/tips'

// What the coach would be seeing and hearing in each example. The tip and the three lines under it are
// worked out by the same code the real coach uses, from these made-up readings.
const SEEN = { present: true, facing: true, away: null, sunk: false, leaning: false, tilted: false }
const HEARD = { speaking: true, spoken: 60, pace: 150 }
const POSES = [
  { id: 'well', label: 'Sitting well', tip: null, flags: SEEN, voice: HEARD },
  { id: 'sunk', label: 'Sunk', tip: 'sunk', flags: { ...SEEN, sunk: true }, voice: HEARD },
  { id: 'down', label: 'Eyes down', tip: 'awayDown', flags: { ...SEEN, facing: false, away: 'down' }, voice: HEARD },
  { id: 'fast', label: 'Talking fast', tip: 'fast', flags: SEEN, voice: { ...HEARD, pace: 205 } },
]

// The coach, with a drawn figure standing in for the camera. Pick an example and the coach says what it
// would say. The first time it scrolls into view the figure sinks by itself, once.
export default function CoachDemo() {
  const [pose, setPose] = useState('well')
  const touched = useRef(false)
  const node = useRef(null)

  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    let timer = 0
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        seen.disconnect()
        timer = setTimeout(() => {
          if (!touched.current) setPose('sunk')
        }, 1100)
      },
      { threshold: 0.6 },
    )
    seen.observe(node.current)
    return () => {
      seen.disconnect()
      clearTimeout(timer)
    }
  }, [])

  const now = POSES.find((p) => p.id === pose)
  const tip = now.tip ? tipText(now.tip, { pace: now.voice.pace }) : null
  const lines = statusLines({ flags: now.flags, eyes: true, why: null, voice: now.voice, dictating: true, canDictate: true, mic: 'on' })

  return (
    <div className="panel-ui coach-demo" ref={node}>
      <div className="coach-demo-view">
        <svg viewBox="0 0 400 300" role="img" aria-label={`A figure in a camera picture: ${now.label.toLowerCase()}.`}>
          <line x1="0" y1="100" x2="400" y2="100" />
          <line x1="200" y1="0" x2="200" y2="300" />
          <g className={`figure ${pose}`}>
            <path d="M86 300c0-42 27-66 62-76 18-5 31-13 31-27v-47h42v47c0 14 13 22 31 27 35 10 62 34 62 76z" />
            <ellipse cx="200" cy="108" rx="40" ry="50" />
            <g className="eyes">
              <circle cx="185" cy="100" r="4.5" />
              <circle cx="215" cy="100" r="4.5" />
            </g>
          </g>
        </svg>
      </div>

      <p className={`coach-tip ${tip ? '' : 'fine'}`} aria-live="polite" key={pose}>
        {tip ? (
          <>
            <strong>{tip[0]}</strong>
            <span>{tip[1]}</span>
          </>
        ) : (
          <strong>
            <Icon name="check" size={16} />
            Looking good
          </strong>
        )}
      </p>

      <dl className="coach-now">
        {lines.map((line) => (
          <div key={line.key} className={line.ok === false ? 'off' : line.ok ? 'ok' : 'idle'}>
            <dt>{line.label}</dt>
            <dd>{line.text}</dd>
          </div>
        ))}
      </dl>

      <div className="seg" role="group" aria-label="What the coach is seeing and hearing">
        {POSES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={pose === p.id}
            onClick={() => {
              touched.current = true
              setPose(p.id)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
