import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  canStartConnecting,
  getFavourites,
  getMyApplications,
  getMySessions,
  uploadCoverLetter,
  uploadTailoredResume,
  withdrawApplication,
} from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Empty, FileLine, Loading, Notice } from '../components/Bits'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import ScoreLine from '../components/ScoreLine'
import ScoreParts from '../components/ScoreParts'
import { PracticeStart, WeeklyStart } from '../components/StartInterview'
import Tabs, { TabPanel } from '../components/Tabs'
import { INTERVIEWS_ENABLED, LIMITS } from '../lib/flags'
import { STATUS_FOR_CANDIDATE, fileUrl, formatDate, formatDay, plural } from '../lib/format'
import { PARTS, SEND_AT, whole } from '../lib/score'
import { practiceUsedToday, sessionState } from '../lib/sessions'
import '../styles/pages.css'

// A PDF that goes with one application: a resume written for this role, or a cover letter.
function Attachment({ label, none, path, onPick, state }) {
  const input = useRef(null)
  const href = fileUrl(path)
  return (
    <div className="stack tight">
      <FileLine href={href} label={label} sub={href ? 'PDF' : none}>
        <button type="button" className="btn secondary sm" onClick={() => input.current?.click()} disabled={state?.busy}>
          {state?.busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" size={16} />}
          {href ? 'Replace' : 'Upload PDF'}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onPick(file)
          }}
        />
      </FileLine>
      {state?.problem && <Notice tone="stop">{state.problem}</Notice>}
    </div>
  )
}

function ApplicationRow({ app, open, onToggle, onChange, onWithdraw }) {
  const [uploads, setUploads] = useState({})
  const parts = PARTS.map((part) => app[part.key])
  const hasParts = parts.every((v) => v != null)

  const upload = (kind, send) => async (file) => {
    if (file.type !== 'application/pdf') {
      setUploads((u) => ({ ...u, [kind]: { problem: 'That is not a PDF. Export the document as a PDF and try again.' } }))
      return
    }
    setUploads((u) => ({ ...u, [kind]: { busy: true } }))
    try {
      const updated = await send(app.id, file)
      onChange({
        ...app,
        tailored_resume_filename: updated.tailored_resume_filename ?? app.tailored_resume_filename,
        cover_letter_filename: updated.cover_letter_filename ?? app.cover_letter_filename,
      })
      setUploads((u) => ({ ...u, [kind]: {} }))
    } catch (err) {
      const message =
        err.status === 503 ? 'File storage is not set up on this server, so the PDF could not be kept.' : err.message
      setUploads((u) => ({ ...u, [kind]: { problem: message } }))
    }
  }

  return (
    <li className={`sheet-row ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="sheet-main"
        aria-expanded={open}
        aria-controls={`app-${app.id}`}
        onClick={onToggle}
      >
        <span className="sheet-who">
          <strong>{app.job_title}</strong>
          <span>{app.company_name}</span>
        </span>
        <span className="sheet-track">
          <ScoreLine value={app.match_score} />
        </span>
        <span className="sheet-score">{whole(app.match_score)}</span>
        <span className="sheet-state">
          <span className={`tag ${app.status === 'contacted' ? 'go' : app.status === 'viewed' ? 'line' : ''}`}>
            {STATUS_FOR_CANDIDATE[app.status] || app.status}
          </span>
        </span>
        <Icon name="chevron-down" size={18} className="sheet-chev" />
      </button>

      <div className="sheet-more" id={`app-${app.id}`} inert={!open}>
        <div>
          <div className="sheet-more-in app-more">
            <div className="stack">
              <h3>How this score was built</h3>
              {hasParts ? (
                <ScoreParts values={parts} />
              ) : (
                <p className="muted">The four parts were not recorded for this score.</p>
              )}
              {app.reasoning && <p className="app-why">{app.reasoning}</p>}
              <p className="hint">Sent {formatDate(app.created_at)}</p>
            </div>

            <div className="stack">
              <h3>Documents for this role</h3>
              <Attachment
                label="Resume for this role"
                none="Not added. The company sees the resume on your profile."
                path={app.tailored_resume_filename}
                state={uploads.resume}
                onPick={upload('resume', uploadTailoredResume)}
              />
              <Attachment
                label="Cover letter"
                none="Not added"
                path={app.cover_letter_filename}
                state={uploads.cover}
                onPick={upload('cover', uploadCoverLetter)}
              />
              <div>
                <button type="button" className="btn danger sm" onClick={onWithdraw}>
                  Withdraw application
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function InterviewHub() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'practice' ? 'practice' : 'weekly'
  const [data, setData] = useState(null)
  const [problem, setProblem] = useState('')
  const [openId, setOpenId] = useState(null)
  const [leaving, setLeaving] = useState(null) // the application being withdrawn
  const [withdrawing, setWithdrawing] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([getMyApplications(), getMySessions(), canStartConnecting(), getFavourites()])
      .then(([applications, sessions, availability, saved]) => {
        if (live) setData({ applications, sessions, availability, saved })
      })
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  const setTab = (id) => setParams(id === 'weekly' ? {} : { tab: id }, { replace: true })

  if (problem && !data) {
    return (
      <AppShell>
        <PageHead title="Interviews" />
        <Notice tone="stop" title="This page could not load.">
          {problem}
        </Notice>
      </AppShell>
    )
  }
  if (!data) {
    return (
      <AppShell>
        <Loading>Loading your interviews</Loading>
      </AppShell>
    )
  }

  const { applications, sessions, availability, saved } = data
  const active = applications.filter((a) => a.status !== 'withdrawn').sort((a, b) => b.match_score - a.match_score)
  const weekly = sessions.filter((s) => s.session_type === 'connecting')
  const practice = sessions.filter((s) => s.session_type === 'mock').slice(0, 10)
  const usedToday = practiceUsedToday(sessions)

  const replace = (next) =>
    setData((d) => ({ ...d, applications: d.applications.map((a) => (a.id === next.id ? next : a)) }))

  const withdraw = async () => {
    setWithdrawing(true)
    setProblem('')
    try {
      await withdrawApplication(leaving.id)
      replace({ ...leaving, status: 'withdrawn' })
      setNote(`Withdrawn from ${leaving.job_title} at ${leaving.company_name}.`)
      setLeaving(null)
      setOpenId(null)
    } catch (err) {
      setProblem(err.message)
      setLeaving(null)
    } finally {
      setWithdrawing(false)
    }
  }

  const tabs = [
    { id: 'weekly', label: 'Weekly', count: active.length || undefined },
    { id: 'practice', label: 'Practice' },
  ]

  return (
    <AppShell>
      <PageHead title="Interviews">The weekly interview sends applications. Practice is for getting better at it.</PageHead>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Interviews" />

      {tab === 'weekly' && (
        <TabPanel id="weekly">
          <WeeklyStart availability={availability} savedIds={saved.map((f) => f.job_id)} />

          <section className="section">
            <div className="section-head">
              <h2>Applications</h2>
              <p>
                A score of {SEND_AT} or more sends one. Open a row for the detail.
              </p>
            </div>

            {note && (
              <div className="page-problem">
                <Notice tone="go" role="status">
                  {note}
                </Notice>
              </div>
            )}
            {problem && (
              <div className="page-problem">
                <Notice tone="stop">{problem}</Notice>
              </div>
            )}

            {active.length === 0 ? (
              <Empty title="No applications yet">
                After your weekly interview, each role where you score {SEND_AT} or more appears here with its score.
              </Empty>
            ) : (
              <div className="sheet">
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
                  {active.map((app) => (
                    <ApplicationRow
                      key={app.id}
                      app={app}
                      open={openId === app.id}
                      onToggle={() => setOpenId(openId === app.id ? null : app.id)}
                      onChange={replace}
                      onWithdraw={() => setLeaving(app)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Past weekly interviews</h2>
            </div>
            {weekly.length === 0 ? (
              <Empty title="None yet">Each weekly interview you take is listed here with what it sent.</Empty>
            ) : (
              <ul className="rows">
                {weekly.map((s) => {
                  const sent = applications.filter((a) => a.session_id === s.id)
                  const state = sessionState(s)
                  const what =
                    state === 'ended'
                      ? 'Ended early. It scored 0 and nothing was sent.'
                      : state === 'scoring'
                        ? 'Waiting to be scored'
                        : state === 'open'
                          ? 'Open in another window'
                          : state === 'left'
                            ? 'Not finished'
                            : sent.length
                              ? `${plural(sent.length, 'application')}: ${sent.map((a) => `${a.job_title} ${whole(a.match_score)}`).join(', ')}`
                              : `No role scored ${SEND_AT} or more`
                  const inner = (
                    <>
                      <span className="linkrow-title">{formatDay(s.created_at)}</span>
                      <span className="linkrow-sub">{what}</span>
                    </>
                  )
                  return (
                    <li key={s.id}>
                      {state === 'open' || state === 'left' ? (
                        <div className="linkrow past-row">{inner}</div>
                      ) : (
                        <Link to={`/results/${s.id}`} className="linkrow past-row">
                          {inner}
                          <Icon name="chevron-right" size={18} />
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </TabPanel>
      )}

      {tab === 'practice' && (
        <TabPanel id="practice">
          <div className="start">
            <div className="start-text">
              <h2>Practice interviews</h2>
              <p>
                {INTERVIEWS_ENABLED
                  ? `Pick a field and a role. ${Math.max(0, LIMITS.practicePerDay - usedToday)} of ${LIMITS.practicePerDay} left today.`
                  : 'Practice interviews are switched off for now.'}
              </p>
            </div>
            <PracticeStart usedToday={usedToday} className="btn primary" />
          </div>

          <section className="section">
            <div className="section-head">
              <h2>Recent practice</h2>
            </div>
            {practice.length === 0 ? (
              <Empty title="No practice interviews yet">
                Each one gives you a score and feedback on every answer.
              </Empty>
            ) : (
              <ul className="rows">
                {practice.map((s) => {
                  const state = sessionState(s)
                  const eyes = s.delivery?.eye_speaking ?? s.delivery?.eye_contact
                  const pace = s.delivery?.pace
                  const inner = (
                    <>
                      <span>
                        <span className="linkrow-title">{s.job_title || 'Practice interview'}</span>
                        <br />
                        <span className="linkrow-sub">
                          {[
                            s.industry,
                            formatDay(s.created_at),
                            eyes != null && `eyes on the camera ${Math.round(eyes * 100)}%`,
                            pace != null && `${pace} words a minute`,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </span>
                      <span className="linkrow-end">
                        {state === 'scored' ? (
                          <>
                            <span className="linkrow-score">{whole(s.overall_score) ?? 0}</span>
                            <Icon name="chevron-right" size={18} />
                          </>
                        ) : state === 'scoring' ? (
                          <>
                            <span className="tag line">Waiting to be scored</span>
                            <Icon name="chevron-right" size={18} />
                          </>
                        ) : (
                          <span className="tag line">{state === 'open' ? 'Open in another window' : 'Left before the end'}</span>
                        )}
                      </span>
                    </>
                  )
                  return (
                    <li key={s.id}>
                      {state === 'scored' || state === 'scoring' ? (
                        <Link to={`/results/${s.id}`} className="linkrow">
                          {inner}
                        </Link>
                      ) : (
                        <div className="linkrow">{inner}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </TabPanel>
      )}

      {leaving && (
        <Modal
          title="Withdraw this application?"
          onClose={() => setLeaving(null)}
          foot={
            <>
              <button type="button" className="btn secondary" onClick={() => setLeaving(null)} data-autofocus>
                Keep it
              </button>
              <button type="button" className="btn danger" onClick={withdraw} disabled={withdrawing}>
                {withdrawing && <span className="spinner" aria-hidden="true" />}
                Withdraw
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="dialog-lead">
              <strong>{leaving.job_title}</strong> at {leaving.company_name}
            </p>
            <ul className="plain-list">
              <li>The company stops seeing you in its list for this role.</li>
              <li>If a later weekly interview scores higher for this role, the application is sent again.</li>
            </ul>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
