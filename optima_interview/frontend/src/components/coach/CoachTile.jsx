import { useState } from 'react'
import { soundCheck } from '../../lib/coach/ready'
import { BETTER_TEXT, TIP_TEXT, tipText } from '../../lib/coach/tips'
import Icon from '../Icon'

// What is checked before the interview starts, and which problems fail each check.
// `must` marks the ones a weekly interview cannot begin without. The rest are advice.
const CHECKS = [
  { label: 'Your face is in the picture', fails: ['absent', 'cut'], must: true },
  { label: 'You are alone in the picture', fails: ['others'], must: true },
  { label: 'Light on your face', fails: ['dim', 'backlit'], must: true },
  { label: 'The picture is sharp', fails: ['blurred'], must: true },
  { label: 'In the middle, eyes a third of the way down', fails: ['offCentre', 'eyesLow', 'eyesHigh'] },
  { label: 'About an arm’s length away', fails: ['close', 'far'] },
  { label: 'Camera level with your eyes', fails: ['cameraLow', 'cameraHigh'] },
]

const WAITING = {
  asking: ['Waiting for your camera and microphone', 'Your browser is asking whether this site may use them.'],
  loading: ['Loading the coach', 'About 4 MB, the first time only.'],
}

// The coach's corner of the interview page: your picture, and either the checks before you start
// or, while you answer, the one tip worth giving and where things stand.
//   mode: 'setup' before the interview, 'settle' during the countdown, 'live' while answering
//   required: the weekly interview, where the camera and microphone are a condition and what they see is recorded
export default function CoachTile({ status, mic, tip: tipKey, better, facts, lines = [], sound, problems, present, attach, mode, count, required = false, lost = false }) {
  const waiting = WAITING[status]
  const on = status === 'on'
  const tip = on && tipKey ? tipText(tipKey, facts) : null
  const fixed = on && !tip && better ? BETTER_TEXT[better] : null
  const allWell = lines.length > 0 && lines.every((line) => line.ok !== false)
  // Some people answer better without watching themselves. The coach keeps looking either way.
  const [hidden, setHidden] = useState(false)
  const tucked = hidden && mode === 'live'
  const heard = soundCheck(mic, sound || { heard: false, problem: null }, required)

  return (
    <div className={`coach ${mode} ${tucked ? 'no-view' : ''}`}>
      <div className={`coach-view ${tucked ? 'tucked' : ''}`}>
        <video ref={attach} autoPlay playsInline muted aria-label="Your camera" />
        {mode !== 'live' && on && (
          <svg className="coach-guide" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="100" x2="400" y2="100" />
            <line x1="200" y1="0" x2="200" y2="300" />
          </svg>
        )}
        {mode === 'settle' && (
          <p className="coach-count" aria-hidden="true">
            {count}
          </p>
        )}
      </div>

      {waiting && (
        <p className="coach-tip" role="status">
          <strong>{waiting[0]}</strong>
          <span>{waiting[1]}</span>
        </p>
      )}

      {on && mode === 'setup' && (
        <ul className="coach-checks">
          {CHECKS.map((check) => {
            // with no face found a line cannot be judged, unless what is wrong with it shows anyway (a dark picture)
            const unknown = !present && check.fails[0] !== 'absent' && !check.fails.some((key) => problems.includes(key))
            const problem = unknown ? null : check.fails.find((key) => problems.includes(key))
            return (
              <li key={check.label} className={`${unknown ? 'unknown' : problem ? 'no' : 'yes'}${required && !check.must ? ' advice' : ''}`}>
                <Icon name={problem || unknown ? 'minus' : 'check'} size={18} />
                <span>
                  {check.label}
                  {problem && <em>{TIP_TEXT[problem][0]}</em>}
                </span>
              </li>
            )
          })}
          <li className={`coach-sound ${heard.state}`}>
            <Icon name={heard.state === 'yes' ? 'check' : heard.state === 'no' ? 'minus' : 'mic'} size={18} />
            <span>
              {heard.label}
              {heard.note && <em>{heard.note}</em>}
            </span>
          </li>
        </ul>
      )}

      {on && mode === 'settle' && (
        <p className="coach-tip" role="status">
          <strong>Look at your camera</strong>
          <span>The coach is noting where your eyes are when you do.</span>
        </p>
      )}

      {lost && mode === 'live' && (
        <p className="coach-tip" role="alert">
          <strong>Your camera has stopped</strong>
          <span>Time without it is recorded as time off camera. Check that nothing else is using it.</span>
        </p>
      )}

      {on && !lost && mode === 'live' && (
        <p className={`coach-tip ${tip ? '' : 'fine'}`} role="status" aria-live="polite" key={tipKey || (fixed ? `better-${better}` : 'fine')}>
          {tip ? (
            <>
              <strong>{tip[0]}</strong>
              <span>{tip[1]}</span>
            </>
          ) : fixed ? (
            <strong>
              <Icon name="check" size={16} />
              {fixed}
            </strong>
          ) : (
            allWell && (
              <strong>
                <Icon name="check" size={16} />
                Looking good
              </strong>
            )
          )}
        </p>
      )}

      {on && mode === 'live' && lines.length > 0 && (
        <dl className="coach-now">
          {lines.map((line) => (
            <div key={line.key} className={line.ok === false ? 'off' : line.ok ? 'ok' : 'idle'}>
              <dt>{line.label}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {on && mode === 'live' && (
        <button type="button" className="link coach-hide" onClick={() => setHidden(!hidden)} aria-pressed={hidden}>
          {hidden ? 'Show my picture' : 'Hide my picture'}
        </button>
      )}

      <p className="coach-private">
        Worked out on this device. No video or sound is saved or sent.
        {required && ' What is kept: time on camera, time turned away from the screen, and whether anyone else was in view.'}
      </p>
    </div>
  )
}
