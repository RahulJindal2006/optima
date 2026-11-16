import { EYE_AIM, advise } from '../lib/coach/tips'
import { VOICE } from '../lib/coach/voice'
import ScoreLine from './ScoreLine'

const percent = (share) => Math.round(share * 100)

const span = (seconds) =>
  seconds >= 90 ? `${Math.round(seconds / 60)} minutes` : seconds >= 60 ? '1 minute' : `${Math.round(seconds)} seconds`

// What the camera measured, each with the level worth aiming for.
const ON_CAMERA = [
  { key: 'eyes', label: (d) => (d.eye_speaking != null ? 'Eyes on the camera while speaking' : 'Eyes on the camera'), at: EYE_AIM * 100 },
  { key: 'posture', label: () => 'Upright and level', at: 75 },
  { key: 'in_frame', label: () => 'In the picture', at: 90 },
  { key: 'steady', label: () => 'Sitting steady', at: 70 },
]

// The share for one of those measures, taken the same way from this interview and from the one before.
function shareOf(key, delivery, like = delivery) {
  if (!delivery) return null
  if (key !== 'eyes') return delivery[key] ?? null
  return (like.eye_speaking != null ? delivery.eye_speaking : delivery.eye_contact) ?? null
}

const LEVEL = { good: 'Good', faint: 'Faint', loud: 'Too loud', noisy: 'Noisy room' }

// A value on a scale, with the stretch worth being in marked on it.
function RangeLine({ value, scale, aim, label }) {
  const place = (v) => Math.max(0, Math.min(100, ((v - scale[0]) / (scale[1] - scale[0])) * 100))
  const fits = value >= aim[0] && value <= aim[1]
  return (
    <span
      className={`rangeline ${fits ? 'fits' : ''}`}
      style={{ '--v': place(value), '--from': place(aim[0]), '--to': place(aim[1]) }}
      role="img"
      aria-label={label}
    >
      <span className="rl-aim" />
      <span className="rl-run">
        <span className="rl-dot" />
      </span>
    </span>
  )
}

function Was({ children }) {
  return <small className="was">{children} last time</small>
}

// How a practice interview came across: on camera and, when answers were spoken, to the ear.
// `delivery` is what the coach sent with the interview. `previous` is the headline of the practice before it.
export default function DeliveryReport({ delivery, previous = null }) {
  if (!delivery) return null
  const voice = delivery.voice || null
  const { fixes, good, notes } = advise(delivery)
  const first = fixes.slice(0, 3)
  const camera = ON_CAMERA.map((m) => ({ ...m, value: shareOf(m.key, delivery), was: shareOf(m.key, previous, delivery) })).filter((m) => m.value != null)
  const rows = delivery.per_question || []
  const has = (key) => rows.some((q) => q[key] != null)
  const eyesKey = has('eye_speaking') ? 'eye_speaking' : 'eye_contact'
  const byQuestion = rows.filter((q) => q.posture != null || q[eyesKey] != null || q.pace != null)

  return (
    <section className="delivery" aria-labelledby="delivery-title">
      <div className="section-head">
        <h2 id="delivery-title">Delivery</h2>
        <p>
          From {span(delivery.seconds || 0)} on camera{voice?.talk >= 5 ? `, ${span(voice.talk)} of it speaking` : ''}. Worked out on your
          device: no video or sound was saved or sent.
        </p>
      </div>

      {first.length > 0 && (
        <div className="coach-block">
          <h3>Work on first</h3>
          <ol className="coach-fixes">
            {first.map((note) => (
              <li key={note.key}>
                <strong>{note.title}</strong>
                <p>{note.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {good.length > 0 && (
        <div className="coach-block">
          <h3>Going well</h3>
          <ul className="coach-good">
            {good.slice(0, 3).map((note) => (
              <li key={note.key}>
                <strong>{note.title}</strong>
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {camera.length > 0 && (
        <div className="coach-block">
          <h3>On camera</h3>
          <ul className="measures">
            {camera.map((m) => {
              const value = percent(m.value)
              return (
                <li key={m.key}>
                  <span>
                    {m.label(delivery)}
                    {m.was != null && percent(m.was) !== value && <Was>{percent(m.was)}%</Was>}
                  </span>
                  <ScoreLine value={value} at={m.at} label={`${value}%. Aim for ${m.at}% or more.`} />
                  <b>{value}%</b>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {voice && (voice.pace != null || voice.range != null || voice.filler_rate != null || voice.level) && (
        <div className="coach-block">
          <h3>Voice</h3>
          <ul className="measures voice">
            {voice.pace != null && (
              <li>
                <span>
                  Pace
                  {previous?.pace != null && previous.pace !== voice.pace && <Was>{previous.pace}</Was>}
                </span>
                <RangeLine
                  value={voice.pace}
                  scale={[60, 240]}
                  aim={VOICE.pace}
                  label={`${voice.pace} words a minute. Aim for ${VOICE.pace[0]} to ${VOICE.pace[1]}.`}
                />
                <b>
                  {voice.pace} <small>words a minute</small>
                </b>
              </li>
            )}
            {voice.range != null && (
              <li>
                <span>
                  Pitch movement
                  {previous?.range != null && previous.range !== voice.range && <Was>{previous.range}</Was>}
                </span>
                <RangeLine
                  value={voice.range}
                  scale={[0, 10]}
                  aim={[VOICE.range[1], 10]}
                  label={`${voice.range} semitones. Aim for ${VOICE.range[1]} or more.`}
                />
                <b>
                  {voice.range} <small>semitones</small>
                </b>
              </li>
            )}
            {voice.filler_rate != null && (
              <li>
                <span>
                  Filler words
                  {previous?.filler_rate != null && previous.filler_rate !== voice.filler_rate && <Was>{previous.filler_rate}</Was>}
                </span>
                <RangeLine
                  value={voice.filler_rate}
                  scale={[0, 8]}
                  aim={[0, VOICE.fillers[0]]}
                  label={`${voice.filler_rate} a minute. Aim for ${VOICE.fillers[0]} or fewer.`}
                />
                <b>
                  {voice.filler_rate >= 10 ? Math.round(voice.filler_rate) : voice.filler_rate} <small>a minute</small>
                </b>
              </li>
            )}
            {voice.level && (
              <li className="plain">
                <span>Volume at the microphone</span>
                <b>{LEVEL[voice.level]}</b>
              </li>
            )}
          </ul>
        </div>
      )}

      <p className="hint measures-note">
        The mark or the shaded stretch on each line is where to aim.
        {voice?.filler_rate != null && ' Filler words are counted from what dictation wrote down. Browsers leave out most “um”s, so the real count is higher.'}
      </p>

      {notes.length > 0 && (
        <ul className="coach-notes">
          {notes.map((note) => (
            <li key={note.key} className="note">
              <span className="label">Note</span>
              <div>
                <strong>{note.title}</strong>
                <p>{note.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {byQuestion.length > 1 && (
        <details className="reveal">
          <summary>Question by question</summary>
          <div className="table-scroll">
            <table className="by-question">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Eyes on the camera</th>
                  <th scope="col">Upright</th>
                  {has('pace') && <th scope="col">Words a minute</th>}
                  {has('fillers') && <th scope="col">Filler words</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((q, i) => (
                  <tr key={i}>
                    <th scope="row">{i + 1}</th>
                    <td>{q[eyesKey] != null ? `${percent(q[eyesKey])}%` : 'Not measured'}</td>
                    <td>{q.posture != null ? `${percent(q.posture)}%` : 'Not measured'}</td>
                    {has('pace') && <td>{q.pace != null ? q.pace : q.talk ? 'Too short to time' : 'Typed'}</td>}
                    {has('fillers') && <td>{q.fillers != null ? q.fillers : q.talk ? 'Too short to count' : 'Typed'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}
