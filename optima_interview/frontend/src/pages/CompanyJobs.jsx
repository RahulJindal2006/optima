import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getIndustries, getMyJobs, getPastJobs, updateJob } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Empty, Facts, Loading, Notice } from '../components/Bits'
import Icon from '../components/Icon'
import JobDetail from '../components/JobDetail'
import JobForm from '../components/JobForm'
import Modal from '../components/Modal'
import Tabs, { TabPanel } from '../components/Tabs'
import { formatDate, jobFacts } from '../lib/format'
import '../styles/pages.css'

function RoleRow({ job, closed, onView, onEdit, onClose, onReopen, busy }) {
  return (
    <li className="role-row">
      <div className="role-main">
        <strong>{job.title}</strong>
        <Facts items={[job.industry, ...jobFacts(job)]} />
        <span className="hint">Posted {formatDate(job.created_at)}</span>
      </div>

      {!closed && (
        <dl className="role-counts">
          <div>
            <dd>{job.candidate_count_65 ?? 0}</dd>
            <dt>at 65 or more</dt>
          </div>
          <div>
            <dd>{job.candidate_count_80 ?? 0}</dd>
            <dt>at 80 or more</dt>
          </div>
        </dl>
      )}

      <div className="cluster role-actions">
        {!closed && (
          <Link to={`/company/jobs/${job.id}/applicants`} className="btn primary sm">
            Applicants
          </Link>
        )}
        <button type="button" className="btn secondary sm" onClick={onView}>
          View
        </button>
        <button type="button" className="btn secondary sm" onClick={onEdit}>
          Edit
        </button>
        {closed ? (
          <button type="button" className="btn secondary sm" onClick={onReopen} disabled={busy}>
            Reopen
          </button>
        ) : (
          <button type="button" className="btn quiet sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </li>
  )
}

export default function CompanyJobs() {
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('open')
  const [open, setOpen] = useState(null)
  const [closed, setClosed] = useState([])
  const [industries, setIndustries] = useState([])
  const [problem, setProblem] = useState('')
  const [form, setForm] = useState(() => (location.state?.post ? { job: null } : null)) // { job } while the form is up
  const [viewing, setViewing] = useState(null)
  const [closing, setClosing] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let live = true
    getIndustries().then((list) => live && setIndustries(list)).catch(() => {})
    Promise.all([getMyJobs(), getPastJobs()])
      .then(([active, past]) => {
        if (!live) return
        setOpen(active)
        setClosed(past)
      })
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  // "Post a role" on the home page arrives here with a note to open the form. Use it once.
  useEffect(() => {
    if (location.state?.post) navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const saved = (job) => {
    setForm(null)
    setProblem('')
    if (job.is_active) {
      setOpen((list) => (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list]))
    } else {
      setClosed((list) => list.map((j) => (j.id === job.id ? job : j)))
    }
  }

  const setActive = async (job, active) => {
    setBusyId(job.id)
    setProblem('')
    try {
      const updated = await updateJob(job.id, { is_active: active })
      if (active) {
        setClosed((list) => list.filter((j) => j.id !== job.id))
        setOpen((list) => [updated, ...list])
      } else {
        setOpen((list) => list.filter((j) => j.id !== job.id))
        setClosed((list) => [updated, ...list])
      }
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusyId(null)
      setClosing(null)
    }
  }

  const tabs = [
    { id: 'open', label: 'Open', count: open?.length },
    { id: 'closed', label: 'Closed', count: closed.length },
  ]

  return (
    <AppShell>
      <PageHead
        title="Roles"
        action={
          <button type="button" className="btn primary" onClick={() => setForm({ job: null })}>
            <Icon name="plus" size={18} />
            Post a role
          </button>
        }
      >
        Candidates who save a role are interviewed on it every week. Anyone who scores 40 or more becomes an applicant.
      </PageHead>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Roles" />

      {problem && (
        <div className="page-problem">
          <Notice tone="stop">{problem}</Notice>
        </div>
      )}

      {open === null && !problem ? (
        <Loading>Loading your roles</Loading>
      ) : (
        <>
          {tab === 'open' && (
            <TabPanel id="open" className={open?.length ? 'flush' : ''}>
              {!open?.length ? (
                <Empty
                  title="No open roles"
                  action={
                    <button type="button" className="btn primary" onClick={() => setForm({ job: null })}>
                      Post a role
                    </button>
                  }
                >
                  Describe the role and add up to five questions of your own.
                </Empty>
              ) : (
                <ul className="rows">
                  {open.map((job) => (
                    <RoleRow
                      key={job.id}
                      job={job}
                      onView={() => setViewing(job)}
                      onEdit={() => setForm({ job })}
                      onClose={() => setClosing(job)}
                    />
                  ))}
                </ul>
              )}
            </TabPanel>
          )}

          {tab === 'closed' && (
            <TabPanel id="closed" className={closed.length ? 'flush' : ''}>
              {closed.length === 0 ? (
                <Empty title="No closed roles">When you close a role it moves here, and you can reopen it.</Empty>
              ) : (
                <ul className="rows">
                  {closed.map((job) => (
                    <RoleRow
                      key={job.id}
                      job={job}
                      closed
                      busy={busyId === job.id}
                      onView={() => setViewing(job)}
                      onEdit={() => setForm({ job })}
                      onReopen={() => setActive(job, true)}
                    />
                  ))}
                </ul>
              )}
            </TabPanel>
          )}
        </>
      )}

      {form && <JobForm job={form.job} industries={industries} onClose={() => setForm(null)} onSaved={saved} />}

      {viewing && (
        <Modal title="How candidates see it" wide onClose={() => setViewing(null)} className="job-dialog">
          <JobDetail job={viewing} showQuestions />
        </Modal>
      )}

      {closing && (
        <Modal
          title="Close this role?"
          onClose={() => setClosing(null)}
          foot={
            <>
              <button type="button" className="btn secondary" onClick={() => setClosing(null)} data-autofocus>
                Keep it open
              </button>
              <button type="button" className="btn danger" onClick={() => setActive(closing, false)} disabled={busyId === closing.id}>
                {busyId === closing.id && <span className="spinner" aria-hidden="true" />}
                Close role
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="dialog-lead">
              <strong>{closing.title}</strong>
            </p>
            <ul className="plain-list">
              <li>It leaves the job board and no new applications arrive.</li>
              <li>You can reopen it from the Closed tab.</li>
            </ul>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
