import { useEffect, useRef, useState } from 'react'
import {
  addFavourite,
  canStartConnecting,
  getFavourites,
  getIndustries,
  getJob,
  getMySessions,
  listJobs,
  removeFavourite,
} from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Empty, Facts, Field, Loading, Notice } from '../components/Bits'
import Choice from '../components/Choice'
import Icon from '../components/Icon'
import JobDetail from '../components/JobDetail'
import Modal from '../components/Modal'
import { PracticeStart, WeeklyStart } from '../components/StartInterview'
import Tabs, { TabPanel } from '../components/Tabs'
import { LIMITS } from '../lib/flags'
import { HOURS_TYPES, LEVELS, LOCATION_TYPES, formatSalary, jobFacts, labelOf, plural } from '../lib/format'
import { practiceUsedToday } from '../lib/sessions'
import useMedia from '../lib/useMedia'
import '../styles/pages.css'

const NO_FILTERS = {
  industry: '',
  location_type: 'any',
  hours_type: 'any',
  job_level: '',
  salary_min: '',
  salary_max: '',
  start_date: '',
  work_term: '',
}

const ARRANGEMENTS = [{ value: 'any', label: 'Any' }, ...LOCATION_TYPES]
const EXTRA = ['salary_min', 'salary_max', 'start_date', 'work_term']

// The button that saves a role, or shows that it is saved.
function SaveButton({ saved, busy, onClick, size = '' }) {
  return (
    // Not disabled while it works: a disabled button drops keyboard focus.
    <button
      type="button"
      className={`btn ${saved ? 'secondary' : 'primary'} ${size}`}
      aria-pressed={saved}
      aria-busy={busy}
      onClick={busy ? undefined : onClick}
    >
      <Icon name={saved ? 'check' : 'bookmark'} size={18} />
      {saved ? 'Saved' : 'Save role'}
    </button>
  )
}

export default function JobPostingsPage() {
  const wide = useMedia('(min-width: 981px)')
  const [tab, setTab] = useState('browse')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)
  const [jobs, setJobs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState([])
  const [availability, setAvailability] = useState(null)
  const [industries, setIndustries] = useState([])
  const [picked, setPicked] = useState(null) // id of the role shown beside the list
  const [opened, setOpened] = useState(null) // a role shown in a dialog (narrow screens, saved roles)
  const [busyId, setBusyId] = useState(null)
  const [problem, setProblem] = useState('')
  const [usedToday, setUsedToday] = useState(null)
  const request = useRef(0)

  // Things that do not depend on the filters.
  useEffect(() => {
    let live = true
    getIndustries().then((list) => live && setIndustries(list)).catch(() => {})
    getFavourites().then((list) => live && setSaved(list)).catch((err) => live && setProblem(err.message))
    canStartConnecting().then((a) => live && setAvailability(a)).catch(() => {})
    getMySessions().then((list) => live && setUsedToday(practiceUsedToday(list))).catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The list itself. Typing in a filter waits a moment before asking again.
  useEffect(() => {
    const id = ++request.current
    const timer = setTimeout(() => {
      setLoading(true)
      listJobs(filters)
        .then((list) => {
          if (id !== request.current) return
          setJobs(list)
          setProblem('')
        })
        .catch((err) => id === request.current && setProblem(err.message))
        .finally(() => id === request.current && setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [filters])

  const savedIds = new Set(saved.map((f) => f.job_id))
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value?.target ? value.target.value : value }))
  const active = Object.keys(NO_FILTERS).filter((key) => filters[key] !== NO_FILTERS[key])
  const extraActive = EXTRA.filter((key) => filters[key] !== '').length

  const current = jobs?.find((job) => job.id === picked) || jobs?.[0] || null

  const toggleSaved = async (job) => {
    setProblem('')
    setBusyId(job.id)
    try {
      if (savedIds.has(job.id)) {
        await removeFavourite(job.id)
        setSaved((list) => list.filter((f) => f.job_id !== job.id))
      } else if (saved.length >= LIMITS.savedRoles) {
        setProblem(`You have saved ${LIMITS.savedRoles} roles, which is the most you can keep. Remove one to save another.`)
      } else {
        const fav = await addFavourite(job.id)
        setSaved((list) => [fav, ...list.filter((f) => f.job_id !== job.id)])
      }
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const choose = (job) => {
    setPicked(job.id)
    if (!wide) setOpened(job)
  }

  const openSaved = async (fav) => {
    const known = jobs?.find((job) => job.id === fav.job_id)
    if (known) {
      setOpened(known)
      return
    }
    try {
      setOpened(await getJob(fav.job_id))
    } catch (err) {
      setProblem(err.message)
    }
  }

  const actionsFor = (job) => (
    <>
      <SaveButton saved={savedIds.has(job.id)} busy={busyId === job.id} onClick={() => toggleSaved(job)} />
      <PracticeStart job={job} usedToday={usedToday} label="Practise for this role" />
    </>
  )

  const tabs = [
    { id: 'browse', label: 'Browse' },
    { id: 'saved', label: 'Saved', count: `${saved.length} of ${LIMITS.savedRoles}` },
  ]

  return (
    <AppShell>
      <PageHead title="Jobs">
        Save up to {LIMITS.savedRoles} roles. Your weekly interview is built from the ones you save.
      </PageHead>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Jobs" />

      {problem && (
        <div className="page-problem">
          <Notice tone="stop">{problem}</Notice>
        </div>
      )}

      {tab === 'browse' && (
        <TabPanel id="browse">
          <form
            className={`filters ${moreOpen ? 'open' : ''}`}
            onSubmit={(event) => event.preventDefault()}
            aria-label="Filter roles"
          >
            <Field label="Field" htmlFor="f-industry">
              <select id="f-industry" className="select" value={filters.industry} onChange={setFilter('industry')}>
                <option value="">All fields</option>
                {industries.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Arrangement" className="filter-extra">
              <Choice
                label="Arrangement"
                options={ARRANGEMENTS}
                value={filters.location_type}
                onChange={setFilter('location_type')}
              />
            </Field>
            <Field label="Hours" htmlFor="f-hours" className="filter-extra">
              <select id="f-hours" className="select" value={filters.hours_type} onChange={setFilter('hours_type')}>
                <option value="any">Any hours</option>
                {HOURS_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Level" htmlFor="f-level" className="filter-extra">
              <select id="f-level" className="select" value={filters.job_level} onChange={setFilter('job_level')}>
                <option value="">Any level</option>
                {LEVELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="filters-end">
              <button
                type="button"
                className="btn secondary"
                aria-expanded={moreOpen}
                aria-controls="more-filters"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <Icon name="filter" size={18} />
                <span className="wide-label">More{extraActive > 0 && ` (${extraActive})`}</span>
                <span className="narrow-label">Filters{active.length > 0 && ` (${active.length})`}</span>
              </button>
              {active.length > 0 && (
                <button type="button" className="btn quiet" onClick={() => setFilters(NO_FILTERS)}>
                  Clear
                </button>
              )}
            </div>

            {moreOpen && (
              <div className="filters-more" id="more-filters">
                <div className="field">
                  <span className="label">Pay per year ($)</span>
                  <div className="input-row">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder="From"
                      aria-label="Lowest pay"
                      value={filters.salary_min}
                      onChange={setFilter('salary_min')}
                    />
                    <span>to</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder="To"
                      aria-label="Highest pay"
                      value={filters.salary_max}
                      onChange={setFilter('salary_max')}
                    />
                  </div>
                </div>
                <Field label="Starts in" htmlFor="f-start">
                  <input
                    id="f-start"
                    className="input"
                    type="month"
                    placeholder="2027-01"
                    value={filters.start_date}
                    onChange={setFilter('start_date')}
                  />
                </Field>
                <Field label="Length (months)" htmlFor="f-term">
                  <input
                    id="f-term"
                    className="input"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={filters.work_term}
                    onChange={setFilter('work_term')}
                  />
                </Field>
              </div>
            )}
          </form>

          {jobs === null ? (
            <Loading>Loading roles</Loading>
          ) : jobs.length === 0 ? (
            <Empty
              title={active.length ? 'No roles match these filters' : 'No open roles yet'}
              action={
                active.length > 0 && (
                  <button type="button" className="btn secondary" onClick={() => setFilters(NO_FILTERS)}>
                    Clear filters
                  </button>
                )
              }
            >
              {active.length ? 'Try removing one.' : 'Roles appear here as companies post them.'}
            </Empty>
          ) : (
            <>
              <p className="result-count" role="status">
                {plural(jobs.length, 'open role')}
              </p>
              <div className="split-view" aria-busy={loading}>
                <ul className="rows picks">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        className="pick"
                        aria-current={wide && current?.id === job.id ? 'true' : undefined}
                        onClick={() => choose(job)}
                      >
                        <span>
                          <span className="pick-title">{job.title}</span>
                          <br />
                          <span className="pick-sub">{job.company_name}</span>
                          <Facts items={jobFacts(job)} />
                        </span>
                        {savedIds.has(job.id) && (
                          <span className="tag">
                            <Icon name="check" size={14} />
                            Saved
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {current && (
                  <div className="split-detail" key={current.id}>
                    <JobDetail job={current} actions={actionsFor(current)} />
                  </div>
                )}
              </div>
            </>
          )}
        </TabPanel>
      )}

      {tab === 'saved' && (
        <TabPanel id="saved">
          <WeeklyStart availability={availability} savedIds={saved.map((f) => f.job_id)} />

          {saved.length === 0 ? (
            <Empty
              title="No saved roles"
              action={
                <button type="button" className="btn primary" onClick={() => setTab('browse')}>
                  Browse roles
                </button>
              }
            >
              Save the roles you would take. Your weekly interview asks about them.
            </Empty>
          ) : (
            <ul className="rows saved-list">
              {saved.map((fav) => (
                <li key={fav.id} className="saved-row">
                  <button type="button" className="saved-main" onClick={() => openSaved(fav)}>
                    <span className="pick-title">{fav.job_title}</span>
                    <span className="pick-sub">{fav.company_name}</span>
                    <Facts
                      items={[
                        fav.industry,
                        labelOf(LOCATION_TYPES, fav.location_type),
                        labelOf(HOURS_TYPES, fav.hours_type),
                        labelOf(LEVELS, fav.job_level),
                        formatSalary(fav.salary_min, fav.salary_max),
                      ].filter(Boolean)}
                    />
                  </button>
                  <div className="cluster">
                    <PracticeStart
                      job={{ title: fav.job_title, industry: fav.industry, company_name: fav.company_name }}
                      usedToday={usedToday}
                      label="Practise"
                      className="btn secondary sm"
                    />
                    <button
                      type="button"
                      className="btn quiet sm"
                      disabled={busyId === fav.job_id}
                      onClick={() => toggleSaved({ id: fav.job_id })}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
      )}

      {opened && (
        <Modal title="Role" wide onClose={() => setOpened(null)} className="job-dialog">
          <JobDetail job={opened} actions={actionsFor(opened)} />
        </Modal>
      )}
    </AppShell>
  )
}
