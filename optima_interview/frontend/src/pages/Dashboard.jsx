import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  canStartConnecting,
  getApplicantsForJob,
  getFavourites,
  getMyApplications,
  getMyJobs,
  getMyProfile,
  getMySessions,
} from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Avatar, Empty, Facts, Loading, Notice } from '../components/Bits'
import Icon from '../components/Icon'
import ScoreLine from '../components/ScoreLine'
import { PracticeStart, WeeklyStart } from '../components/StartInterview'
import { INTERVIEWS_ENABLED } from '../lib/flags'
import { STATUS_FOR_CANDIDATE, firstName, formatDay, jobFacts, plural } from '../lib/format'
import { practiceUsedToday } from '../lib/sessions'
import { SEND_AT, whole } from '../lib/score'
import '../styles/pages.css'

// ───────── Candidate ─────────

function CandidateHome({ user }) {
  const [data, setData] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([getMySessions(), getMyApplications(), canStartConnecting(), getFavourites(), getMyProfile()])
      .then(([sessions, applications, availability, saved, profile]) => {
        if (live) setData({ sessions, applications, availability, saved, profile })
      })
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  if (problem) {
    return (
      <>
        <PageHead title={`Hi, ${firstName(user.name)}`} />
        <Notice tone="stop" title="This page could not load.">
          {problem}
        </Notice>
      </>
    )
  }
  if (!data) return <Loading>Loading your home page</Loading>

  const { sessions, applications, availability, saved, profile } = data
  const active = applications.filter((a) => a.status !== 'withdrawn').sort((a, b) => b.match_score - a.match_score)
  const practice = sessions.filter((s) => s.session_type === 'mock' && s.status === 'completed').slice(0, 3)
  const noResume = !profile.resume_filename && !profile.resume_text
  const noSkills = !profile.skills?.length
  const missingShare = (noResume ? 15 : 0) + (noSkills ? 10 : 0)

  return (
    <>
      <PageHead title={`Hi, ${firstName(user.name)}`}>
        {active.length
          ? `${plural(active.length, 'application')} out, from ${plural(saved.length, 'saved role')}.`
          : 'Save the roles you want, then take one interview a week.'}
      </PageHead>

      <div className="stack">
        <WeeklyStart availability={availability} savedIds={saved.map((f) => f.job_id)} />

        {missingShare > 0 && (
          <Notice icon="alert">
            <strong>
              Your profile has no {noResume && noSkills ? 'resume or skills' : noResume ? 'resume' : 'skills'}.
            </strong>{' '}
            That part of every match score ({missingShare}%) counts as zero until you add{' '}
            {noResume && noSkills ? 'them' : noResume ? 'one' : 'some'}.{' '}
            <Link to="/profile?tab=resume" className="link">
              Complete your profile
            </Link>
          </Notice>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Applications</h2>
          {active.length > 0 && (
            <Link to="/interview-hub" className="link">
              See all {active.length}
            </Link>
          )}
        </div>
        {active.length === 0 ? (
          <Empty title="No applications yet">
            After your weekly interview, every role where you score {SEND_AT} or more shows up here.
          </Empty>
        ) : (
          <div className="sheet plain">
            <ul className="sheet-rows">
              {active.slice(0, 5).map((a) => (
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
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Practice</h2>
          <PracticeStart usedToday={practiceUsedToday(sessions)} className="btn secondary sm" />
        </div>
        {practice.length === 0 ? (
          <Empty title="No practice interviews yet">
            {INTERVIEWS_ENABLED
              ? 'A practice interview gives you a score and feedback on every answer.'
              : 'Practice interviews are switched off for now.'}
          </Empty>
        ) : (
          <ul className="rows">
            {practice.map((s) => (
              <li key={s.id}>
                <Link to={`/results/${s.id}`} className="linkrow">
                  <span>
                    <span className="linkrow-title">{s.job_title}</span>
                    <br />
                    <span className="linkrow-sub">
                      {s.industry}, {formatDay(s.created_at)}
                    </span>
                  </span>
                  <span className="linkrow-end">
                    <span className="linkrow-score">{whole(s.overall_score) ?? 0}</span>
                    <Icon name="chevron-right" size={18} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// ───────── Company ─────────

function CompanyHome({ user }) {
  const [data, setData] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    getMyJobs()
      .then(async (jobs) => {
        // One request per open role, so the page can say how many applicants are new.
        const lists = await Promise.all(jobs.slice(0, 20).map((job) => getApplicantsForJob(job.id).catch(() => [])))
        if (live) setData({ jobs, applicants: jobs.slice(0, 20).map((job, i) => ({ job, list: lists[i] })) })
      })
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  if (problem) {
    return (
      <>
        <PageHead title={user.name} />
        <Notice tone="stop" title="This page could not load.">
          {problem}
        </Notice>
      </>
    )
  }
  if (!data) return <Loading>Loading your home page</Loading>

  const { jobs, applicants } = data
  const everyone = applicants.flatMap(({ job, list }) => list.map((person) => ({ ...person, job })))
  const fresh = everyone.filter((p) => p.status === 'applied').sort((a, b) => b.match_score - a.match_score)

  return (
    <>
      <PageHead
        title={user.name}
        action={
          <Link to="/company/jobs" state={{ post: true }} className="btn primary">
            <Icon name="plus" size={18} />
            Post a role
          </Link>
        }
      >
        {jobs.length
          ? `${plural(jobs.length, 'open role')}, ${plural(everyone.length, 'applicant')}${fresh.length ? `, ${fresh.length} new` : ''}.`
          : 'Post a role and applicants arrive ranked by how well they fit.'}
      </PageHead>

      {jobs.length === 0 ? (
        <Empty
          title="No open roles"
          action={
            <Link to="/company/jobs" state={{ post: true }} className="btn primary">
              Post your first role
            </Link>
          }
        >
          Describe the role and add up to five questions of your own. Candidates who save it are interviewed on it
          every week.
        </Empty>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2>New applicants</h2>
              <p>Best match first</p>
            </div>
            {fresh.length === 0 ? (
              <Empty title="Nobody new">
                Applicants appear here as soon as a weekly interview scores {SEND_AT} or more for one of your roles.
              </Empty>
            ) : (
              <ul className="rows">
                {fresh.slice(0, 5).map((p) => (
                  <li key={p.application_id}>
                    <Link to={`/company/jobs/${p.job.id}/applicants`} state={{ open: p.application_id }} className="people-row linked">
                      <Avatar name={p.candidate_name} src={p.candidate_profile_picture_url} />
                      <span className="people-who">
                        <span className="people-name">{p.candidate_name}</span>
                        <span className="linkrow-sub">{p.job.title}</span>
                      </span>
                      <ScoreLine value={p.match_score} />
                      <span className="people-score">{whole(p.match_score)}</span>
                      <Icon name="chevron-right" size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Open roles</h2>
              <Link to="/company/jobs" className="link">
                Manage roles
              </Link>
            </div>
            <ul className="rows">
              {applicants.map(({ job, list }) => {
                const waiting = list.filter((p) => p.status === 'applied').length
                return (
                  <li key={job.id}>
                    <Link to={`/company/jobs/${job.id}/applicants`} className="linkrow stacks">
                      <span>
                        <span className="linkrow-title">{job.title}</span>
                        <Facts items={[job.industry, ...jobFacts(job)]} />
                      </span>
                      <span className="linkrow-end">
                        {waiting > 0 && <span className="tag">{waiting} new</span>}
                        <span className="linkrow-count">{plural(list.length, 'applicant')}</span>
                        <Icon name="chevron-right" size={18} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}

      <p className="page-foot-link">
        <Link to="/rubric" className="link">
          How scoring works
        </Link>
      </p>
    </>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  return <AppShell>{user.role === 'company' ? <CompanyHome user={user} /> : <CandidateHome user={user} />}</AppShell>
}
