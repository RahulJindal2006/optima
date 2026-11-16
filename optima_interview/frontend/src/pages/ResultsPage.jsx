import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getApplicationsForSession, getMySessions, getResults, scoreInterview } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Empty, Loading, Notice } from '../components/Bits'
import DeliveryReport from '../components/DeliveryReport'
import FairPlay from '../components/FairPlay'
import Icon from '../components/Icon'
import ScoreLine from '../components/ScoreLine'
import { PracticeStart } from '../components/StartInterview'
import { STATUS_FOR_CANDIDATE, countWords, formatDate, plural } from '../lib/format'
import { SEND_AT, whole } from '../lib/score'
import '../styles/pages.css'

// The grader is told that a solid answer lands between 82 and 90 (backend/claude_client.py).
const SOLID = 82

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

// "1 min 40 s" for the time spent on a question.
const spent = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`)

function Answer({ text }) {
  if (!text || !text.trim()) return <p className="muted">No answer was given.</p>
  return <p className="prose answer">{text}</p>
}

function QuestionResult({ q, number }) {
  const hit = Array.isArray(q.key_points_hit) ? q.key_points_hit : []
  const missed = (Array.isArray(q.key_points) ? q.key_points : []).filter((point) => !hit.some((h) => same(h, point)))
  const score = whole(q.score)

  return (
    <li className="result">
      <div className="result-head">
        <span className="result-n">
          Question {number}
          {q.question_type === 'code' && <span className="tag line">Code</span>}
          {q.seconds >= 3 && !q.late && q.user_answer?.trim() && <span>{spent(q.seconds)}</span>}
        </span>
        {score != null && (
          <span className="result-score">
            <ScoreLine value={score} at={SOLID} label={`${score} out of 100`} />
            <b>{score}</b>
          </span>
        )}
      </div>
      <h3>{q.question_text}</h3>

      {q.late ? (
        <Notice icon="clock">This answer reached the server after its time was up, so it was not counted.</Notice>
      ) : (
        q.feedback && <p className="result-feedback">{q.feedback}</p>
      )}

      {(hit.length > 0 || missed.length > 0) && (
        <div className="feedback-cols">
          {hit.length > 0 && (
            <div>
              <span className="label">Covered</span>
              <ul className="points">
                {hit.map((point, i) => (
                  <li className="hit" key={`${point}-${i}`}>
                    <Icon name="check" size={18} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missed.length > 0 && (
            <div>
              <span className="label">Missed</span>
              <ul className="points">
                {missed.map((point, i) => (
                  <li className="missed" key={`${point}-${i}`}>
                    <Icon name="minus" size={18} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <details className="reveal">
        <summary>
          Your answer{q.user_answer?.trim() ? ` (${plural(countWords(q.user_answer), 'word')})` : ''}
        </summary>
        <Answer text={q.user_answer} />
      </details>
    </li>
  )
}

// A weekly interview: no answers to read back, only what it sent.
function WeeklyOutcome({ sessionId, session }) {
  const [sent, setSent] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    getApplicationsForSession(sessionId)
      .then((list) => live && setSent(list))
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [sessionId])

  return (
    <>
      <PageHead title="Interview submitted" back={{ to: '/interview-hub', label: 'Interviews' }}>
        {formatDate(session.completed_at || session.created_at)}. Answers from a weekly interview are not shown again.
      </PageHead>

      {problem && <Notice tone="stop">{problem}</Notice>}
      {!problem && sent === null && <Loading>Loading what was sent</Loading>}

      {sent && sent.length === 0 && (
        <Empty
          title={`No role scored ${SEND_AT} or more`}
          action={
            <Link to="/interview-hub?tab=practice" className="btn primary">
              Practise before next week
            </Link>
          }
        >
          Nothing was sent this time. A resume and skills on your profile count for a quarter of every score.
        </Empty>
      )}

      {sent && sent.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Sent to {plural(sent.length, 'role')}</h2>
            <p>A score of {SEND_AT} or more sends the application</p>
          </div>
          <div className="sheet plain">
            <ul className="sheet-rows">
              {sent.map((a) => (
                <li className="sheet-row" key={a.id}>
                  <Link to="/interview-hub" className="sheet-main">
                    <span className="sheet-who">
                      <strong>{a.job_title}</strong>
                      <span>{a.company_name}</span>
                    </span>
                    <span className="sheet-track">
                      <ScoreLine value={a.match_score} />
                    </span>
                    <span className="sheet-score">{whole(a.match_score)}</span>
                    <span className="sheet-state">{STATUS_FOR_CANDIDATE[a.status] || a.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="cluster result-actions">
            <Link to="/interview-hub" className="btn primary">
              See your applications
            </Link>
            <Link to="/job-postings" className="btn secondary">
              Browse more roles
            </Link>
          </div>
        </section>
      )}

      {session.fair_play && (
        <section className="section fairplay-section">
          <div className="section-head">
            <h2>How you took it</h2>
            <p>Companies see this with your application</p>
          </div>
          <FairPlay record={session.fair_play} />
        </section>
      )}
    </>
  )
}

// A weekly interview that was closed, left too often, or never begun.
function EndedEarly({ session }) {
  return (
    <>
      <PageHead title="Interview ended early" back={{ to: '/interview-hub', label: 'Interviews' }}>
        {formatDate(session.completed_at || session.created_at)}. It scored 0 and nothing was sent to any company.
      </PageHead>
      <FairPlay record={session.fair_play} />
      <p className="ended-next">
        This week’s interview is used. The next one opens seven days after this one was started. Until then, practice
        interviews run under the same clock without anything being held against you.
      </p>
      <div className="cluster result-actions">
        <Link to="/interview-hub?tab=practice" className="btn primary">
          Practise before next week
        </Link>
        <Link to="/rubric" className="btn secondary">
          Read the rules
        </Link>
      </div>
    </>
  )
}

// Every answer is in but the interview has not been scored (the page was closed while it was being scored,
// or the grader was failing). Ask for it again: scoring carries on from what is already saved.
function useScoring(sessionId, data, setData) {
  const waiting = Boolean(data?.awaiting_scoring)
  const [problem, setProblem] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!waiting) return undefined
    let live = true
    scoreInterview(sessionId, {}, () => live)
      .then((result) => live && setData(result))
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [waiting, sessionId, setData, tries])
  const retry = () => {
    setProblem('')
    setTries((n) => n + 1)
  }
  return { waiting, problem, retry }
}

export default function ResultsPage() {
  const { sessionId } = useParams()
  const [data, setData] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    getResults(sessionId)
      .then((result) => live && setData(result))
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [sessionId])

  const scoring = useScoring(sessionId, data, setData)

  // the coach's numbers from the practice before this one, so the report can say what changed
  const [previous, setPrevious] = useState(null)
  const hasDelivery = Boolean(data?.delivery)
  const createdAt = data?.created_at
  useEffect(() => {
    if (!hasDelivery) return undefined
    let live = true
    getMySessions()
      .then((sessions) => {
        const earlier = sessions.find((s) => s.session_type === 'mock' && s.delivery && String(s.id) !== String(sessionId) && s.created_at < createdAt)
        if (live) setPrevious(earlier ? earlier.delivery : null)
      })
      .catch(() => {}) // the report stands without the comparison
    return () => {
      live = false
    }
  }, [hasDelivery, createdAt, sessionId])

  if (problem) {
    return (
      <AppShell narrow>
        <PageHead title="Results" back={{ to: '/interview-hub', label: 'Interviews' }} />
        <Notice tone="stop" title="These results could not load.">
          {problem}
        </Notice>
      </AppShell>
    )
  }
  if (!data) {
    return (
      <AppShell narrow>
        <Loading>Loading results</Loading>
      </AppShell>
    )
  }

  if (scoring.waiting) {
    return (
      <AppShell narrow>
        {scoring.problem ? (
          <>
            <PageHead title="Scoring did not finish" back={{ to: '/interview-hub', label: 'Interviews' }}>
              Your answers are saved. Nothing is lost by trying again, now or later.
            </PageHead>
            <Notice tone="stop">{scoring.problem}</Notice>
            <div className="cluster result-actions">
              <button type="button" className="btn primary" onClick={scoring.retry}>
                Try again
              </button>
              <Link to="/interview-hub" className="btn secondary">
                Back to interviews
              </Link>
            </div>
          </>
        ) : (
          <>
            <PageHead title="Scoring your interview" back={{ to: '/interview-hub', label: 'Interviews' }}>
              Your answers are saved. This page shows the result as soon as it is ready.
            </PageHead>
            <Loading>Scoring</Loading>
          </>
        )}
      </AppShell>
    )
  }

  if (data.session_type === 'connecting') {
    return (
      <AppShell narrow>
        {data.status === 'completed' && data.ended_reason ? (
          <EndedEarly session={data} />
        ) : data.status === 'completed' ? (
          <WeeklyOutcome sessionId={sessionId} session={data} />
        ) : (
          <>
            <PageHead title="Interview not finished" back={{ to: '/interview-hub', label: 'Interviews' }} />
            <p className="muted">
              {data.status === 'in_progress'
                ? 'This weekly interview is still open in another window.'
                : 'This weekly interview was left before the end, so nothing was scored.'}
            </p>
          </>
        )}
      </AppShell>
    )
  }

  const overall = whole(data.overall_score) ?? 0
  const answered = data.questions.filter((q) => q.user_answer?.trim()).length

  return (
    <AppShell narrow>
      <PageHead title="Practice results" back={{ to: '/interview-hub?tab=practice', label: 'Interviews' }}>
        {data.job_title}, {data.industry}. {formatDate(data.completed_at || data.created_at)}
      </PageHead>

      {data.status !== 'completed' ? (
        <p className="muted">
          {data.status === 'in_progress'
            ? 'This practice interview is still open in another window.'
            : 'This practice interview was left before the end, so there is nothing to show.'}
        </p>
      ) : (
        <>
          <div className="stage overall">
            <p className="overall-score">
              <span className="sr-only">Overall score </span>
              {overall}
            </p>
            <div className="overall-side">
              <p className="overall-line">
                {overall >= SOLID ? 'In the range for solid answers.' : `${SOLID - overall} below the range for solid answers.`}
              </p>
              <ScoreLine value={overall} at={SOLID} label={`${overall} out of 100. Solid answers start at ${SOLID}.`} />
              <div className="lab-scale" aria-hidden="true">
                <i>0</i>
                <i className="at" style={{ left: `${SOLID}%` }}>
                  {SOLID}
                </i>
                <i style={{ left: '100%' }}>100</i>
              </div>
              <p className="hint">
                The average of {plural(data.questions.length, 'question')}, {answered} answered. The grader is told that
                a solid answer lands between {SOLID} and 90.
              </p>
            </div>
          </div>

          <DeliveryReport delivery={data.delivery} previous={previous} />

          <ol className="results">
            {data.questions.map((q, i) => (
              <QuestionResult q={q} number={i + 1} key={q.id} />
            ))}
          </ol>

          <div className="cluster result-actions">
            <PracticeStart
              job={{ title: data.job_title, industry: data.industry }}
              label="Practise this role again"
              className="btn primary"
            />
            <Link to="/interview-hub?tab=practice" className="btn secondary">
              Back to interviews
            </Link>
          </div>
        </>
      )}
    </AppShell>
  )
}
