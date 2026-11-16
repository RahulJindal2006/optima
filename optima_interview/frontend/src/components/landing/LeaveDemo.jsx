import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { LIMITS } from '../../lib/flags'
import { plural } from '../../lib/format'

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// The weekly interview notices when you leave its window. This panel does the same thing on this page,
// so a visitor can see it happen: switch to another tab, come back, and it has kept count.
// Nothing here is sent or stored. It is gone when the page is.
export default function LeaveDemo() {
  const [events, setEvents] = useState([]) // { kind: 'left', seconds } or { kind: 'paste' }
  const [here, setHere] = useState(0) // seconds in this window since arriving or coming back
  const leftAt = useRef(null)

  useEffect(() => {
    const onChange = () => {
      if (document.hidden) {
        leftAt.current = Date.now()
      } else if (leftAt.current) {
        const seconds = Math.max(1, Math.round((Date.now() - leftAt.current) / 1000))
        leftAt.current = null
        setEvents((list) => [...list, { kind: 'left', seconds, n: list.filter((e) => e.kind === 'left').length + 1 }])
        setHere(0)
      }
    }
    document.addEventListener('visibilitychange', onChange)
    const timer = setInterval(() => {
      if (!document.hidden) setHere((n) => n + 1)
    }, 1000)
    return () => {
      document.removeEventListener('visibilitychange', onChange)
      clearInterval(timer)
    }
  }, [])

  const leaves = events.filter((e) => e.kind === 'left').length
  const over = leaves > LIMITS.leavesAllowed
  const shown = events.slice(-4)

  return (
    <div className="panel-ui leave-demo">
      <div className="leave-head">
        <span>How the interview was taken</span>
        <span className="leave-here">
          In this window <b className="digits">{clock(here)}</b>
        </span>
      </div>

      <ul className="leave-rows" aria-live="polite">
        {events.length === 0 && (
          <li className="clean">
            <Icon name="check" size={18} />
            <span>Stayed in the window. No paste attempts.</span>
          </li>
        )}
        {shown.map((event, i) => (
          <li key={events.length - shown.length + i}>
            <Icon name="alert" size={18} />
            {event.kind === 'left' ? (
              <span>
                Left the window for {plural(event.seconds, 'second')}.
                <em>
                  {event.n > LIMITS.leavesAllowed ? ' That would have ended it.' : ` ${event.n} of ${LIMITS.leavesAllowed} allowed.`}
                </em>
              </span>
            ) : (
              <span>Tried to paste. Nothing was pasted.</span>
            )}
          </li>
        ))}
      </ul>

      {over && <p className="leave-over">In a weekly interview the third time ends it, with a score of 0.</p>}

      <div className="leave-try">
        <label htmlFor="paste-try" className="sr-only">
          Try to paste something here
        </label>
        <input
          id="paste-try"
          className="input"
          placeholder="Try to paste something here"
          autoComplete="off"
          onPaste={(event) => {
            event.preventDefault()
            setEvents((list) => [...list, { kind: 'paste' }])
          }}
        />
        {events.length > 0 && (
          <button type="button" className="btn quiet sm" onClick={() => setEvents([])}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
