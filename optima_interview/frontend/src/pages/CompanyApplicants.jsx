import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { getApplicantsForJob, getJob, updateApplicationStatus } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Avatar, Empty, Facts, FileLine, Loading, Notice, Skills } from '../components/Bits'
import FairPlay from '../components/FairPlay'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import ScoreLine from '../components/ScoreLine'
import ScoreParts from '../components/ScoreParts'
import { STATUS_FOR_COMPANY, fileUrl, jobFacts, plural } from '../lib/format'
import { PARTS, SEND_AT, whole } from '../lib/score'
import useMedia from '../lib/useMedia'
import '../styles/pages.css'

const tagFor = (status) => (status === 'contacted' ? 'go' : status === 'viewed' ? 'line' : '')

// Everything a company is shown about one applicant. Age, sex, ethnicity and disability are never
// sent to a company: they have no place in a hiring decision.
function ApplicantDetail({ person, onStatus, busy, problem }) {
  const parts = PARTS.map((part) => person[part.key])
  const hasParts = parts.every((v) => v != null)
  const score = whole(person.match_score)
  const resumeUrl = fileUrl(person.resume_is_tailored ? person.tailored_resume_filename : person.candidate_resume_filename)
  const coverUrl = fileUrl(person.cover_letter_filename)

  return (
    <article className="person">
      <header className="person-head">
        <Avatar name={person.candidate_name} src={person.candidate_profile_picture_url} size="lg" />
        <div>
          <h2>{person.candidate_name}</h2>
          {person.candidate_location && <p>{person.candidate_location}</p>}
        </div>
        <span className={`tag ${tagFor(person.status)}`}>{STATUS_FOR_COMPANY[person.status] || person.status}</span>
      </header>

      <dl className="pairs">
        <dt>Email</dt>
        <dd>
          <a className="link" href={`mailto:${person.candidate_email}`}>
            {person.candidate_email}
          </a>
        </dd>
        {person.candidate_phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a className="link" href={`tel:${person.candidate_phone}`}>
                {person.candidate_phone}
              </a>
            </dd>
          </>
        )}
      </dl>

      <div className="cluster">
        {person.status === 'applied' && (
          <button type="button" className="btn secondary sm" onClick={() => onStatus('viewed')} disabled={busy}>
            Mark as viewed
          </button>
        )}
        {person.status !== 'contacted' ? (
          <button type="button" className="btn primary sm" onClick={() => onStatus('contacted')} disabled={busy}>
            Mark as contacted
          </button>
        ) : (
          <button type="button" className="btn secondary sm" onClick={() => onStatus('viewed')} disabled={busy}>
            Move back to viewed
          </button>
        )}
      </div>
      {problem && <Notice tone="stop">{problem}</Notice>}

      <section>
        <div className="person-score">
          <b>{score}</b>
          <div>
            <h3>Match score</h3>
            <ScoreLine value={person.match_score} label={`${score} out of 100. Applications are sent at ${SEND_AT}.`} />
          </div>
        </div>
        {hasParts ? (
          <ScoreParts values={parts} />
        ) : (
          <p className="muted">The four parts were not recorded for this score.</p>
        )}
        {person.reasoning && (
          <div className="person-why">
            <h3>Why this score</h3>
            <p>{person.reasoning}</p>
          </div>
        )}
      </section>

      <section>
        <h3>How the interview was taken</h3>
        <FairPlay record={person.fair_play} />
      </section>

      {person.candidate_skills?.length > 0 && (
        <section>
          <h3>Skills</h3>
          <Skills items={person.candidate_skills} />
        </section>
      )}

      <section>
        <h3>Resume</h3>
        {resumeUrl ? (
          <FileLine
            href={resumeUrl}
            label={person.resume_is_tailored ? 'Resume written for this role' : 'Resume from their profile'}
            sub="PDF"
          />
        ) : (
          !person.candidate_resume_text && <p className="muted">No resume was provided.</p>
        )}
        {person.candidate_resume_text && (
          <details className="reveal">
            <summary>Read the resume as text</summary>
            <p className="prose">{person.candidate_resume_text}</p>
          </details>
        )}
      </section>

      {(coverUrl || person.cover_letter_text) && (
        <section>
          <h3>Cover letter</h3>
          {coverUrl && <FileLine href={coverUrl} label="Cover letter" sub="PDF" />}
          {person.cover_letter_text && (
            <details className="reveal">
              <summary>Read the cover letter as text</summary>
              <p className="prose">{person.cover_letter_text}</p>
            </details>
          )}
        </section>
      )}
    </article>
  )
}

export default function CompanyApplicants() {
  const { jobId } = useParams()
  const location = useLocation()
  const wide = useMedia('(min-width: 981px)')
  const [job, setJob] = useState(null)
  const [people, setPeople] = useState(null)
  const [loadProblem, setLoadProblem] = useState('')
  const [pickedId, setPickedId] = useState(location.state?.open ?? null)
  const [dialogId, setDialogId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([getApplicantsForJob(jobId), getJob(jobId)])
      .then(([list, posting]) => {
        if (!live) return
        setPeople(list)
        setJob(posting)
      })
      .catch((err) => live && setLoadProblem(err.message))
    return () => {
      live = false
    }
  }, [jobId])

  const current = people?.find((p) => p.application_id === pickedId) || people?.[0] || null
  const inDialog = people?.find((p) => p.application_id === dialogId) || null

  const choose = (person) => {
    setProblem('')
    setPickedId(person.application_id)
    if (!wide) setDialogId(person.application_id)
  }

  const setStatus = (person) => async (status) => {
    setBusy(true)
    setProblem('')
    try {
      await updateApplicationStatus(person.application_id, status)
      setPeople((list) => list.map((p) => (p.application_id === person.application_id ? { ...p, status } : p)))
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusy(false)
    }
  }

  const back = { to: '/company/jobs', label: 'Roles' }

  if (loadProblem) {
    return (
      <AppShell>
        <PageHead title="Applicants" back={back} />
        <Notice tone="stop" title="The applicants could not load.">
          {loadProblem}
        </Notice>
      </AppShell>
    )
  }
  if (!people || !job) {
    return (
      <AppShell>
        <Loading>Loading applicants</Loading>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <PageHead title={job.title} back={back}>
        {people.length ? `${plural(people.length, 'applicant')}, best match first.` : 'No applicants yet.'}
      </PageHead>
      <Facts items={[job.industry, ...jobFacts(job)]} className="under-head" />

      {people.length === 0 ? (
        <Empty title="Nobody has applied yet">
          An applicant appears when a candidate’s weekly interview scores {SEND_AT} or more for this role.
          {!job.is_active && ' This role is closed, so no new applications will arrive.'}
        </Empty>
      ) : (
        <div className="split-view">
          <ol className="rows picks">
            {people.map((person, i) => (
              <li key={person.application_id}>
                <button
                  type="button"
                  className="pick person-pick"
                  aria-current={wide && current?.application_id === person.application_id ? 'true' : undefined}
                  onClick={() => choose(person)}
                >
                  <span className="people-rank">{i + 1}</span>
                  <Avatar name={person.candidate_name} src={person.candidate_profile_picture_url} />
                  <span className="people-who">
                    <span className="people-name">{person.candidate_name}</span>
                    <span className="pick-sub">{STATUS_FOR_COMPANY[person.status] || person.status}</span>
                  </span>
                  <ScoreLine value={person.match_score} />
                  <span className="people-score">{whole(person.match_score)}</span>
                  <Icon name="chevron-right" size={18} className="pick-chev" />
                </button>
              </li>
            ))}
          </ol>
          {current && (
            <div className="split-detail" key={current.application_id}>
              <ApplicantDetail person={current} onStatus={setStatus(current)} busy={busy} problem={problem} />
            </div>
          )}
        </div>
      )}

      {inDialog && !wide && (
        <Modal title="Applicant" wide onClose={() => setDialogId(null)} className="job-dialog">
          <ApplicantDetail person={inDialog} onStatus={setStatus(inDialog)} busy={busy} problem={problem} />
        </Modal>
      )}
    </AppShell>
  )
}
