import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getMyProfile, updateMyProfile, uploadAvatar, uploadResume } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Avatar, Field, FileLine, Loading, Notice } from '../components/Bits'
import Choice from '../components/Choice'
import Combobox from '../components/Combobox'
import Icon from '../components/Icon'
import ImageCropModal from '../components/ImageCropModal'
import SaveBar from '../components/SaveBar'
import Tabs, { TabPanel } from '../components/Tabs'
import TagInput from '../components/TagInput'
import { LIMITS } from '../lib/flags'
import { HOURS_TYPES, LEVELS, LOCATION_TYPES, countWords, fileUrl } from '../lib/format'
import { LOCATIONS } from '../lib/locations'
import useDirty from '../lib/useDirty'
import '../styles/pages.css'

const TABS = [
  { id: 'about', label: 'About you' },
  { id: 'resume', label: 'Resume and skills' },
  { id: 'preferences', label: 'Preferences' },
]

const ANY = { value: 'any', label: 'Any' }
const text = (value) => (value == null ? '' : String(value))

// The part of the profile this page edits, as the form holds it (everything is text or a list).
const toForm = (p) => ({
  phone_number: text(p.phone_number),
  skills: p.skills || [],
  desired_roles: p.desired_roles || [],
  location: text(p.location),
  distance_km: text(p.distance_km),
  work_type: text(p.work_type),
  pay_any: !p.pay_min && !p.pay_max,
  pay_min: text(p.pay_min),
  pay_max: text(p.pay_max),
  hours_type: text(p.hours_type),
  level: text(p.level),
  start_date: text(p.start_date),
  work_term: text(p.work_term),
  age: text(p.age),
  sex: text(p.sex),
  gender: text(p.gender),
  ethnicity: text(p.ethnicity),
  disabilities: text(p.disabilities),
})

const whole = (value) => (value === '' ? null : parseInt(value, 10))

// What the API expects back: empty fields are sent as null.
const toPayload = (f) => ({
  phone_number: f.phone_number.trim() || null,
  skills: f.skills.length ? f.skills : null,
  desired_roles: f.desired_roles.length ? f.desired_roles : null,
  location: f.location.trim() || null,
  distance_km: whole(f.distance_km),
  work_type: f.work_type || null,
  pay_min: f.pay_any ? null : whole(f.pay_min),
  pay_max: f.pay_any ? null : whole(f.pay_max),
  hours_type: f.hours_type || null,
  level: f.level || null,
  start_date: f.start_date || null,
  work_term: f.work_term.trim() || null,
  age: whole(f.age),
  sex: f.sex || null,
  gender: f.gender.trim() || null,
  ethnicity: f.ethnicity.trim() || null,
  disabilities: f.disabilities.trim() || null,
})

// Returns [tab, message] for the first thing wrong, or null.
function firstProblem(f) {
  const age = whole(f.age)
  if (f.age !== '' && (Number.isNaN(age) || age < 16 || age > 100)) {
    return ['about', 'Enter an age between 16 and 100, or leave it empty.']
  }
  const min = whole(f.pay_min)
  const max = whole(f.pay_max)
  if (!f.pay_any && min != null && max != null && min > max) {
    return ['preferences', 'The lowest pay is higher than the highest pay.']
  }
  if (f.distance_km !== '' && whole(f.distance_km) < 0) return ['preferences', 'Distance cannot be less than zero.']
  return null
}

export default function CandidateProfile() {
  const { user, updateUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'about'

  const [account, setAccount] = useState(null) // what uploads change: picture and resume
  const [saved, setSaved] = useState(null) // the form as the server last had it
  const [form, setForm] = useState(null)
  const [loadProblem, setLoadProblem] = useState('')
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [cropSrc, setCropSrc] = useState(null)
  const [resumeState, setResumeState] = useState({ busy: false, problem: '', done: false })
  const photoInput = useRef(null)
  const resumeInput = useRef(null)
  const dirty = useDirty(form, saved)

  useEffect(() => {
    let live = true
    getMyProfile()
      .then((p) => {
        if (!live) return
        setAccount(p)
        setSaved(toForm(p))
        setForm(toForm(p))
      })
      .catch((err) => live && setLoadProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  const setTab = (id) => setParams(id === 'about' ? {} : { tab: id }, { replace: true })
  const set = (key) => (value) => {
    setJustSaved(false)
    setForm((f) => ({ ...f, [key]: value?.target ? value.target.value : value }))
  }

  const save = async () => {
    setProblem('')
    const bad = firstProblem(form)
    if (bad) {
      setTab(bad[0])
      setProblem(bad[1])
      return
    }
    setSaving(true)
    try {
      const updated = await updateMyProfile(toPayload(form))
      setAccount((a) => ({ ...a, ...updated }))
      setSaved(toForm(updated))
      setForm(toForm(updated))
      setJustSaved(true)
    } catch (err) {
      setProblem(err.message)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setForm(saved)
    setProblem('')
  }

  const pickPhoto = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result)
    reader.readAsDataURL(file)
  }

  const savePhoto = async (file) => {
    const updated = await uploadAvatar(file)
    // The address stays the same when a picture is replaced, so add something that changes.
    const url = updated.profile_picture_url ? `${updated.profile_picture_url}?t=${Date.now()}` : null
    setAccount((a) => ({ ...a, profile_picture_url: url }))
    updateUser({ profile_picture_url: url })
    setCropSrc(null)
  }

  const pickResume = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') {
      setResumeState({ busy: false, problem: 'That is not a PDF. Export your resume as a PDF and try again.', done: false })
      return
    }
    setResumeState({ busy: true, problem: '', done: false })
    try {
      const updated = await uploadResume(file)
      setAccount((a) => ({ ...a, resume_filename: updated.resume_filename, resume_text: updated.resume_text }))
      setResumeState({ busy: false, problem: '', done: true })
    } catch (err) {
      setResumeState({ busy: false, problem: err.message, done: false })
    }
  }

  if (loadProblem) {
    return (
      <AppShell narrow>
        <PageHead title="Profile" />
        <Notice tone="stop" title="Your profile could not load.">
          {loadProblem}
        </Notice>
      </AppShell>
    )
  }
  if (!form) {
    return (
      <AppShell narrow>
        <Loading>Loading your profile</Loading>
      </AppShell>
    )
  }

  const resumeUrl = fileUrl(account.resume_filename)
  const resumeWords = countWords(account.resume_text)

  return (
    <AppShell narrow>
      <PageHead title="Profile">
        Your skills and resume make up a quarter of every match score. The rest helps companies reach you.
      </PageHead>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Profile sections" />

      {tab === 'about' && (
        <TabPanel id="about">
          <div className="identity">
            <Avatar name={user.name} src={account.profile_picture_url} size="lg" />
            <div>
              <strong>{user.name}</strong>
              <span>{account.email}</span>
            </div>
            <button type="button" className="btn secondary sm" onClick={() => photoInput.current?.click()}>
              {account.profile_picture_url ? 'Change photo' : 'Add a photo'}
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
          </div>

          <div className="form-section">
            <h2>Contact</h2>
            <p className="hint">Companies you apply to see your name, email and phone number.</p>
            <div className="form-grid">
              <Field label="Email" htmlFor="email" hint="The email you log in with.">
                <input id="email" className="input" type="email" value={account.email} disabled />
              </Field>
              <Field label="Phone" htmlFor="phone" optional>
                <input
                  id="phone"
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone_number}
                  onChange={set('phone_number')}
                />
              </Field>
            </div>
          </div>

          <div className="form-section">
            <h2>More about you</h2>
            <p className="hint">All optional. None of this is used in scoring.</p>
            <div className="form-grid">
              <Field label="Age" htmlFor="age">
                <input
                  id="age"
                  className="input"
                  type="number"
                  min="16"
                  max="100"
                  inputMode="numeric"
                  value={form.age}
                  onChange={set('age')}
                />
              </Field>
              <Field label="Sex" htmlFor="sex">
                <select id="sex" className="select" value={form.sex} onChange={set('sex')}>
                  <option value="">Not given</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Intersex">Intersex</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Gender identity" htmlFor="gender">
                <input id="gender" className="input" value={form.gender} onChange={set('gender')} />
              </Field>
              <Field label="Ethnicity" htmlFor="ethnicity">
                <input id="ethnicity" className="input" value={form.ethnicity} onChange={set('ethnicity')} />
              </Field>
              <Field label="Disabilities" htmlFor="disabilities" className="wide">
                <input id="disabilities" className="input" value={form.disabilities} onChange={set('disabilities')} />
              </Field>
            </div>
          </div>
        </TabPanel>
      )}

      {tab === 'resume' && (
        <TabPanel id="resume">
          <div className="form-section">
            <h2>Resume</h2>
            <p className="hint">A PDF. Its text is compared with each job, for 15% of the match score.</p>
            <div className="stack">
              {resumeUrl ? (
                <FileLine
                  href={resumeUrl}
                  label="Your resume"
                  sub={resumeWords ? `PDF, ${resumeWords.toLocaleString()} words read` : 'PDF'}
                >
                  <button
                    type="button"
                    className="btn secondary sm"
                    onClick={() => resumeInput.current?.click()}
                    disabled={resumeState.busy}
                  >
                    {resumeState.busy && <span className="spinner" aria-hidden="true" />}
                    Replace
                  </button>
                </FileLine>
              ) : (
                <div className="dropzone">
                  <p>No resume yet.</p>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => resumeInput.current?.click()}
                    disabled={resumeState.busy}
                  >
                    {resumeState.busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" size={18} />}
                    Upload a PDF
                  </button>
                </div>
              )}
              <input ref={resumeInput} type="file" accept="application/pdf,.pdf" hidden onChange={pickResume} />

              {resumeState.problem && <Notice tone="stop">{resumeState.problem}</Notice>}
              {resumeState.done && (
                <p className="saved-note" role="status">
                  <Icon name="check" size={16} />
                  Resume uploaded
                </p>
              )}
              {resumeUrl && !resumeWords && (
                <Notice icon="alert" title="No text could be read from this PDF.">
                  It may be a scan or an image. Until a PDF with real text is uploaded, the resume part of your score
                  stays at zero.
                </Notice>
              )}
              {resumeWords > 0 && (
                <details className="reveal">
                  <summary>Show the text read from your resume</summary>
                  <p className="prose">{account.resume_text}</p>
                </details>
              )}
            </div>
          </div>

          <div className="form-section">
            <h2 id="skills-title">Skills</h2>
            <p className="hint" id="skills-hint">
              Compared with the skills each job asks for, for 10% of the match score. Press Enter after each one.
            </p>
            <TagInput
              id="skills"
              tags={form.skills}
              onChange={set('skills')}
              placeholder="Python, SQL, React"
              labelledBy="skills-title"
              describedBy="skills-hint"
            />
          </div>
        </TabPanel>
      )}

      {tab === 'preferences' && (
        <TabPanel id="preferences">
          <p className="hint tab-note">What you are looking for. None of this changes your score.</p>
          <div className="stack">
            <Field
              label="Roles you want"
              htmlFor="desired_roles"
              hint={`Up to ${LIMITS.desiredRoles} job titles. Press Enter after each one.`}
            >
              <TagInput
                id="desired_roles"
                tags={form.desired_roles}
                onChange={set('desired_roles')}
                max={LIMITS.desiredRoles}
                placeholder="Software Engineer"
              />
            </Field>

            <div className="form-grid">
              <Field label="Where" htmlFor="location">
                <Combobox
                  id="location"
                  options={LOCATIONS}
                  value={form.location}
                  onChange={set('location')}
                  placeholder="Toronto, ON"
                />
              </Field>
              <Field label="How far you would travel (km)" htmlFor="distance_km">
                <input
                  id="distance_km"
                  className="input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.distance_km}
                  onChange={set('distance_km')}
                />
              </Field>
            </div>

            <Field label="Arrangement">
              <Choice
                label="Arrangement"
                options={[...LOCATION_TYPES, ANY]}
                value={form.work_type}
                onChange={set('work_type')}
                allowNone
              />
            </Field>

            <Field label="Hours">
              <Choice label="Hours" options={[...HOURS_TYPES, ANY]} value={form.hours_type} onChange={set('hours_type')} allowNone />
            </Field>

            <Field label="Level">
              <Choice label="Level" options={LEVELS} value={form.level} onChange={set('level')} allowNone />
            </Field>

            <div className="field">
              <span className="label">Pay per year ($)</span>
              <div className="input-row">
                <input
                  className="input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  aria-label="Lowest pay"
                  placeholder="From"
                  value={form.pay_any ? '' : form.pay_min}
                  onChange={set('pay_min')}
                  disabled={form.pay_any}
                />
                <span>to</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  aria-label="Highest pay"
                  placeholder="To"
                  value={form.pay_any ? '' : form.pay_max}
                  onChange={set('pay_max')}
                  disabled={form.pay_any}
                />
              </div>
              <label className="check">
                <input type="checkbox" checked={form.pay_any} onChange={(event) => set('pay_any')(event.target.checked)} />
                Any pay
              </label>
            </div>

            <div className="form-grid">
              <Field label="Earliest start" htmlFor="start_date" optional>
                <input id="start_date" className="input" type="date" value={form.start_date} onChange={set('start_date')} />
              </Field>
              <Field label="Length of work" htmlFor="work_term" optional>
                <input
                  id="work_term"
                  className="input"
                  value={form.work_term}
                  onChange={set('work_term')}
                  placeholder="4 months, or permanent"
                />
              </Field>
            </div>
          </div>
        </TabPanel>
      )}

      {problem && (
        <div className="form-problem">
          <Notice tone="stop">{problem}</Notice>
        </div>
      )}

      <SaveBar dirty={dirty} saving={saving} saved={justSaved} onSave={save} onDiscard={discard} />

      {cropSrc && <ImageCropModal imageSrc={cropSrc} onClose={() => setCropSrc(null)} onCropDone={savePhoto} shape="round" />}
    </AppShell>
  )
}
