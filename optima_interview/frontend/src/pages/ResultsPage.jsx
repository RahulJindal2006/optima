import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getApplicationsForSession, getMySessions, getResults, scoreInterview } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Empty, Loading, Notice } from '../components/Bits'
import DeliveryReport from '../components/DeliveryReport'
import FairPlay from '../components/FairPlay'
import ScoreLine from '../components/ScoreLine'
import Scorecard from '../components/Scorecard'
import { PracticeStart } from '../components/StartInterview'
import { STATUS_FOR_CANDIDATE, countWords, formatDate, plural } from '../lib/format'
import { SEND_AT, SOLID_AT, whole } from '../lib/score'
import '../styles/pages.css'

const KIND = { general: 'General', role: 'About the role', long: 'Long', code: 'Code' }

// "1 min 40 s" for the time spent on a question.
const spent = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`)

// 7.5 stays 7.5, 6.0 becomes 6.
const tidy = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)))

// Why a question has no scorecard to show, if it has none.
function without(q) {
  if (q.late) return ['clock', 'This answer reached the server after its time was up, so it was not counted.']
  if (q.ungraded) return ['info', 'This answer could not be graded, so it is left out of the score.']
  if (q.flagged === 'manipulation') return ['alert', 'This answer contained instructions aimed at the grader, so it scored 0.']
  if (q.rubric?.blank || !q.rubric) return [null, 'No answer was given. A skipped question scores 0.']
  return null
}

// One question: its score, the scorecard behind it, and the answer that was given, folded away.
function QuestionResult({ q, number }) {
  const score = whole(q.score)
  const none = without(q)
  const kind = KIND[q.category] || (q.question_type === 'code' ? 'Code' : null)

  return (
    <li className="result">
      <div className="result-head">
        <span className="result-n">
          Question {number}
          {kind && <span className="tag line">{kind}</span>}
          {q.seconds >= 3 && !q.late && !q.rubric?.blank && <span>{spent(q.seconds)}</span>}
        </span>
        {score != null && (
          <span className="result-score">
            <ScoreLine value={score} at={SOLID_AT} label={`${score} out of 100`} />
            <b>{score}</b>
          </span>
        )}
      </div>
      <h3>{q.question_text}</h3>

      {none ? (
        none[0] ? (
          <Notice icon={none[0]}>{none[1]}</Notice>
        ) : (
          <p className="muted">{none[1]}</p>
        )
      ) : (
        <Scorecard rubric={q.rubric} />
      )}
      {q.flagged === 'unexplained' && <Notice icon="alert">Most of this answer appeared in the page without being typed or dictated there.</Notice>}
      {q.flagged === 'voice' && <Notice icon="alert">This answer came through dictation with almost no voice heard by the microphone.</Notice>}

      {q.user_answer?.trim() && (
        <details className="reveal">
          <summary>Your answer ({plural(countWords(q.user_answer), 'word')})</summary>
          <p className="prose answer">{q.user_answer}</p>
        </details>
      )}
    </li>
  )
}

// How the interview's score was reached: the number, how many questions were answered, what the camera cost.
function ScoreSummary({ data, weekly }) {
  const overall = whole(data.overall_score) ?? 0
  const card = data.scorecard || {}
  const done = card.completion || { answered: data.questions.filter((q) => q.user_answer?.trim()).length, total: data.questions.length, complete: true }
  const cost = card.presence?.deduction || 0
  const line =
    overall >= 85
      ? 'Strong answers across the interview.'
      : overall >= SOLID_AT
        ? 'Solid answers across the interview.'
        : `${SOLID_AT - overall} below the mark for solid answers.`

  return (
    <>
      <div className="stage overall">
        <p className="overall-score">
          <span className="sr-only">Interview score </span>
          {overall}
        </p>
        <div className="overall-side">
          <p className="overall-line">{line}</p>
          <ScoreLine value={overall} at={SOLID_AT} label={`${overall} out of 100. Solid answers start at ${SOLID_AT}.`} />
          <div className="lab-scale" aria-hidden="true">
            <i>0</i>
            <i className="at" style={{ left: `${SOLID_AT}%` }}>
              {SOLID_AT}
            </i>
            <i style={{ left: '100%' }}>100</i>
          </div>
          <p className="hint">
            {done.answered} of {plural(done.total, 'question')} answered. Each question counts by the time it was given, and
            a skipped one counts as 0.
            {cost > 0 && ` The answers came to ${tidy(card.raw)}. The camera took ${tidy(cost)} off.`}
          </p>
        </div>
      </div>

      {!done.complete && (
        <Notice tone={weekly ? 'stop' : undefined} icon={weekly ? undefined : 'info'} title={`${done.answered} of ${done.total} questions answered.`}>
          {weekly
            ? `At least ${done.needed} are needed for an interview to be sent, so nothing was sent to any company.`
            : `In a weekly interview at least ${done.needed} are needed, or nothing is sent to any company.`}
        </Notice>
      )}
    </>
  )
}

// A weekly interview: its score, what it sent, how it was taken, and the scorecard for every question.
function WeeklyOutcome({ sessionId, session }) {
  const [sent, setSent] = useState(null)
  const [problem, setProblem] = useState('')
  const complete = session.scorecard?.completion?.complete !== false
  const unscored = session.scorecard?.unscored_roles || 0

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
        {formatDate(session.completed_at || session.created_at)}. The scorecard for each answer is below.
      </PageHead>

      <ScoreSummary data={session} weekly />

      {problem && <Notice tone="stop">{problem}</Notice>}
      {!problem && sent === null && <Loading>Loading what was sent</Loading>}

      {sent && sent.length === 0 && complete && (
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
        <section className="section">
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
      {unscored > 0 && (
        <Notice icon="info">
          {plural(unscored, 'role')} could not be scored this time, so nothing was sent for {unscored === 1 ? 'it' : 'them'}.
        </Notice>
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

      <section className="section">
        <div className="section-head">
          <h2>Question by question</h2>
          <p>Each line of the scorecard, the level it reached, and what it added</p>
        </div>
        <ol className="results">
          {session.questions.map((q, i) => (
            <QuestionResult q={q} number={i + 1} key={q.id} />
          ))}
        </ol>
      </section>

      <DeliveryReport delivery={session.delivery} previous={null} />
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
          <ScoreSummary data={data} />

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
