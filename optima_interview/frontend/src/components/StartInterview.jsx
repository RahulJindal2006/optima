import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getIndustries, getRolesForIndustry } from '../api/client'
import { INTERVIEWS_ENABLED, LIMITS } from '../lib/flags'
import { daysUntil, formatDay, plural } from '../lib/format'
import { SEND_AT } from '../lib/score'
import { practiceResetsAt } from '../lib/sessions'
import { Field, Notice } from './Bits'
import Modal from './Modal'

export function InterviewsOff() {
  return (
    <Notice title="Interviews are switched off for now.">
      You can still browse and save roles, and keep your profile up to date.
    </Notice>
  )
}

// The weekly interview: where it stands, and the way in.
// `availability` is what GET /interviews/can-connect returned; `savedIds` are the saved roles.
export function WeeklyStart({ availability, savedIds = [] }) {
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)

  if (!INTERVIEWS_ENABLED) return <InterviewsOff />
  if (!availability) return null

  if (!availability.can_connect) {
    const days = daysUntil(availability.next_available)
    return (
      <div className="start">
        <div className="start-text">
          <h2>This week’s interview is done</h2>
          <p>
            The next one opens {formatDay(availability.next_available)}
            {days != null && (days === 0 ? ', later today' : `, in ${plural(days, 'day')}`)}.
          </p>
        </div>
      </div>
    )
  }

  if (savedIds.length === 0) {
    return (
      <div className="start">
        <div className="start-text">
          <h2>Save a role to get started</h2>
          <p>Your weekly interview is built from the roles you save. Save at least one, up to {LIMITS.savedRoles}.</p>
        </div>
        <Link to="/job-postings" className="btn primary">
          Browse jobs
        </Link>
      </div>
    )
  }

  const start = () => {
    setAsking(false)
    navigate('/interview', { state: { sessionType: 'connecting', favouriteJobIds: savedIds } })
  }

  return (
    <div className="start">
      <div className="start-text">
        <h2>Your weekly interview is ready</h2>
        <p>
          {LIMITS.weeklyQuestions} questions built from your {plural(savedIds.length, 'saved role')}. Up to{' '}
          {Math.round((LIMITS.weeklyQuestions * LIMITS.verbalSeconds) / 60)} minutes.
        </p>
      </div>
      <button type="button" className="btn primary" onClick={() => setAsking(true)}>
        Start weekly interview
      </button>

      {asking && (
        <Modal
          title="Start this week’s interview?"
          onClose={() => setAsking(false)}
          foot={
            <>
              <button type="button" className="btn secondary" onClick={() => setAsking(false)}>
                Not now
              </button>
              <button type="button" className="btn primary" onClick={start} data-autofocus>
                Start interview
              </button>
            </>
          }
        >
          <ul className="plain-list">
            <li>
              {LIMITS.weeklyQuestions} questions, one at a time, five minutes each. When the time runs out your answer
              is sent and the next question starts. You cannot go back.
            </li>
            <li>
              It runs in full screen. Leaving the window is recorded, and the third time ends the interview. Pasting
              is turned off.
            </li>
            <li>Closing the page part-way ends it with a score of 0, and nothing is sent.</li>
            <li>
              Your answers are scored against every open role in the same field as your saved roles. Wherever you
              score {SEND_AT} or more, your application is sent.
            </li>
            <li>You get one of these every {LIMITS.weeklyEveryDays} days. Starting uses it.</li>
          </ul>
        </Modal>
      )}
    </div>
  )
}

// A practice interview: pick a field and a role, or practise for one role straight away.
// `job` (optional) is a posting to practise for. `usedToday` is how many were started today, when known.
export function PracticeStart({ job, usedToday, label = 'Start a practice interview', className = 'btn secondary' }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [industries, setIndustries] = useState([])
  const [roles, setRoles] = useState([])
  const [industry, setIndustry] = useState('')
  const [role, setRole] = useState('')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!open || job) return
    let live = true
    getIndustries()
      .then((list) => live && setIndustries(list))
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [open, job])

  const chooseIndustry = (value) => {
    setIndustry(value)
    setRole('')
    setRoles([])
    if (!value) return
    getRolesForIndustry(value)
      .then(setRoles)
      .catch((err) => setProblem(err.message))
  }

  if (!INTERVIEWS_ENABLED) return null

  const leftToday = usedToday == null ? null : Math.max(0, LIMITS.practicePerDay - usedToday)
  const title = job ? job.title : role
  const field = job ? job.industry : industry
  const ready = Boolean(title && field) && leftToday !== 0

  const start = () => {
    if (!ready) return
    setOpen(false)
    navigate('/interview', { state: { jobTitle: title, industry: field, sessionType: 'mock' } })
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>

      {open && (
        <Modal
          title={job ? 'Practise for this role?' : 'Start a practice interview'}
          onClose={() => setOpen(false)}
          foot={
            <>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={start} disabled={!ready}>
                Start practice
              </button>
            </>
          }
        >
          <div className="stack">
            {job ? (
              <p className="dialog-lead">
                <strong>{job.title}</strong>
                {job.company_name ? ` at ${job.company_name}` : ''}
              </p>
            ) : (
              <>
                <Field label="Field" htmlFor="practice-industry">
                  <select
                    id="practice-industry"
                    className="select"
                    value={industry}
                    onChange={(event) => chooseIndustry(event.target.value)}
                    data-autofocus
                  >
                    <option value="">Choose a field</option>
                    {industries.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Role" htmlFor="practice-role">
                  <select
                    id="practice-role"
                    className="select"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    disabled={!industry}
                  >
                    <option value="">{industry ? 'Choose a role' : 'Choose a field first'}</option>
                    {roles.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            <ul className="plain-list">
              <li>
                {LIMITS.practiceQuestions} questions, plus {LIMITS.practiceCodeQuestions} coding questions for technical
                roles. Five minutes each, ten for coding.
              </li>
              <li>Every answer comes back with a score, what you covered and what you missed.</li>
              <li>You can turn on a coach for tips on eye contact, posture and how you sound.</li>
              <li>
                Up to {LIMITS.practicePerDay} a day
                {leftToday != null && `. You have ${leftToday} left today`}.
              </li>
            </ul>

            {leftToday === 0 && (
              <Notice>
                You have used today’s {LIMITS.practicePerDay} practice interviews. The count starts again at{' '}
                {practiceResetsAt()}.
              </Notice>
            )}
            {problem && <Notice tone="stop">{problem}</Notice>}
          </div>
        </Modal>
      )}
    </>
  )
}
