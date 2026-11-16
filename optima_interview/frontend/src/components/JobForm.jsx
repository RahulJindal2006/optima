import { useState } from 'react'
import { createJob, updateJob } from '../api/client'
import { Field, Notice } from './Bits'
import Choice from './Choice'
import Combobox from './Combobox'
import Icon from './Icon'
import Modal from './Modal'
import TagInput from './TagInput'
import { LIMITS } from '../lib/flags'
import { HOURS_TYPES, LEVELS, LOCATION_TYPES } from '../lib/format'
import { LOCATIONS } from '../lib/locations'

const EDUCATION = [
  'High School Diploma',
  "Associate's Degree",
  "Bachelor's Degree",
  "Master's Degree",
  'PhD / Doctorate',
]

const text = (value) => (value == null ? '' : String(value))

const toForm = (job) => ({
  title: text(job?.title),
  industry: text(job?.industry),
  description: text(job?.description),
  responsibilities: text(job?.responsibilities),
  required_skills: job?.required_skills || [],
  education_required: text(job?.education_required),
  experience_required: text(job?.experience_required),
  certifications_required: text(job?.certifications_required),
  location: text(job?.location),
  location_type: text(job?.location_type),
  salary_min: text(job?.salary_min),
  salary_max: text(job?.salary_max),
  hours_type: text(job?.hours_type),
  job_level: text(job?.job_level),
  start_date: text(job?.start_date),
  work_term: text(job?.work_term),
  specific_questions: job?.specific_questions?.length ? job.specific_questions : [''],
})

const whole = (value) => (value === '' ? null : parseInt(value, 10))
const orNull = (value) => value.trim() || null

// Post a new role, or change one. `job` is the posting being edited, if any.
export default function JobForm({ job, industries, onClose, onSaved }) {
  const editing = Boolean(job)
  const [form, setForm] = useState(() => toForm(job))
  const [errors, setErrors] = useState({})
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value?.target ? value.target.value : value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }))
  }

  const setQuestion = (i, value) =>
    setForm((f) => ({ ...f, specific_questions: f.specific_questions.map((q, j) => (j === i ? value : q)) }))
  const addQuestion = () => setForm((f) => ({ ...f, specific_questions: [...f.specific_questions, ''] }))
  const removeQuestion = (i) =>
    setForm((f) => {
      const rest = f.specific_questions.filter((_, j) => j !== i)
      return { ...f, specific_questions: rest.length ? rest : [''] }
    })

  const submit = async (event) => {
    event.preventDefault()
    setProblem('')
    const found = {}
    if (!form.title.trim()) found.title = 'Give the role a title.'
    if (!form.industry) found.industry = 'Choose a field.'
    if (!form.location_type) found.location_type = 'Choose an arrangement.'
    const min = whole(form.salary_min)
    const max = whole(form.salary_max)
    if (min != null && max != null && min > max) found.salary = 'The lowest pay is higher than the highest pay.'
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      document.getElementById(`job-${firstBad}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      responsibilities: orNull(form.responsibilities),
      required_skills: form.required_skills,
      education_required: form.education_required || null,
      experience_required: orNull(form.experience_required),
      certifications_required: orNull(form.certifications_required),
      location: orNull(form.location),
      location_type: form.location_type,
      salary_min: min,
      salary_max: max,
      hours_type: form.hours_type || null,
      job_level: form.job_level || null,
      start_date: form.start_date || null,
      work_term: orNull(form.work_term),
      specific_questions: form.specific_questions.map((q) => q.trim()).filter(Boolean),
    }

    setSaving(true)
    try {
      // The field cannot be changed after posting: the API takes it only when a role is created.
      const result = editing ? await updateJob(job.id, payload) : await createJob({ ...payload, industry: form.industry })
      onSaved(result)
    } catch (err) {
      setProblem(err.message)
      setSaving(false)
    }
  }

  const questions = form.specific_questions

  return (
    <Modal
      title={editing ? 'Edit role' : 'Post a role'}
      wide
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="job-form" className="btn primary" disabled={saving}>
            {saving && <span className="spinner" aria-hidden="true" />}
            {editing ? 'Save changes' : 'Post role'}
          </button>
        </>
      }
    >
      <form id="job-form" onSubmit={submit} noValidate>
        <div className="form-section">
          <div className="form-grid">
            <Field label="Title" htmlFor="job-title" error={errors.title}>
              <input
                id="job-title"
                className="input"
                value={form.title}
                onChange={set('title')}
                placeholder="Frontend Engineer"
                aria-invalid={errors.title ? true : undefined}
                data-autofocus
              />
            </Field>
            <Field
              label="Field"
              htmlFor="job-industry"
              error={errors.industry}
              hint={editing ? 'The field cannot be changed after posting.' : undefined}
            >
              <select
                id="job-industry"
                className="select"
                value={form.industry}
                onChange={set('industry')}
                disabled={editing}
                aria-invalid={errors.industry ? true : undefined}
              >
                <option value="">Choose a field</option>
                {[...new Set([...industries, form.industry].filter(Boolean))].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="About the role"
              htmlFor="job-description"
              className="wide"
              hint="Candidates’ answers are scored against this text. The more specific it is, the better the ranking."
            >
              <textarea
                id="job-description"
                className="textarea"
                maxLength={20000}
                rows={4}
                value={form.description}
                onChange={set('description')}
              />
            </Field>
            <Field label="What they would do" htmlFor="job-responsibilities" className="wide" optional>
              <textarea
                id="job-responsibilities"
                className="textarea"
                maxLength={20000}
                rows={3}
                value={form.responsibilities}
                onChange={set('responsibilities')}
              />
            </Field>
            <Field
              label="Skills"
              htmlFor="job-skills"
              className="wide"
              hint="Compared with the skills on each candidate’s profile. Press Enter after each one."
            >
              <TagInput
                id="job-skills"
                tags={form.required_skills}
                onChange={set('required_skills')}
                placeholder="React, TypeScript"
              />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Place, hours and pay</h3>
          <div className="form-grid">
            <Field label="Location" htmlFor="job-location" optional>
              <Combobox
                id="job-location"
                options={LOCATIONS}
                value={form.location}
                onChange={set('location')}
                placeholder="Toronto, ON"
              />
            </Field>
            <Field label="Arrangement" error={errors.location_type}>
              <span id="job-location_type" />
              <Choice label="Arrangement" options={LOCATION_TYPES} value={form.location_type} onChange={set('location_type')} />
            </Field>
            <Field label="Hours" optional>
              <Choice label="Hours" options={HOURS_TYPES} value={form.hours_type} onChange={set('hours_type')} allowNone />
            </Field>
            <Field label="Level" optional>
              <Choice label="Level" options={LEVELS} value={form.job_level} onChange={set('job_level')} allowNone />
            </Field>
            <div className="field wide">
              <span className="label" id="job-salary">
                Pay per year ($) <span className="opt">(optional)</span>
              </span>
              <div className="input-row">
                <input
                  className="input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="From"
                  aria-label="Lowest pay"
                  value={form.salary_min}
                  onChange={(event) => {
                    set('salary_min')(event)
                    setErrors((e) => ({ ...e, salary: '' }))
                  }}
                />
                <span>to</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="To"
                  aria-label="Highest pay"
                  value={form.salary_max}
                  onChange={(event) => {
                    set('salary_max')(event)
                    setErrors((e) => ({ ...e, salary: '' }))
                  }}
                />
              </div>
              {errors.salary && (
                <p className="field-error">
                  <Icon name="alert" size={16} />
                  {errors.salary}
                </p>
              )}
            </div>
            <Field label="Start date" htmlFor="job-start" optional>
              <input id="job-start" className="input" type="date" value={form.start_date} onChange={set('start_date')} />
            </Field>
            <Field label="Length in months" htmlFor="job-term" optional hint="Leave empty for a permanent role.">
              <input
                id="job-term"
                className="input"
                type="number"
                min="1"
                max="60"
                inputMode="numeric"
                value={form.work_term}
                onChange={set('work_term')}
              />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Requirements</h3>
          <div className="form-grid">
            <Field label="Education" htmlFor="job-education" optional>
              <select id="job-education" className="select" value={form.education_required} onChange={set('education_required')}>
                <option value="">No requirement</option>
                {[...new Set([...EDUCATION, form.education_required].filter(Boolean))].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Experience" htmlFor="job-experience" optional>
              <input
                id="job-experience"
                className="input"
                value={form.experience_required}
                onChange={set('experience_required')}
                placeholder="2 or more years"
              />
            </Field>
            <Field label="Certifications" htmlFor="job-certifications" className="wide" optional>
              <input
                id="job-certifications"
                className="input"
                value={form.certifications_required}
                onChange={set('certifications_required')}
              />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Your questions</h3>
          <p className="hint">
            Up to {LIMITS.ownQuestions}. Candidates who saved this role get them in their weekly interview, reworded
            slightly.
          </p>
          <ol className="question-inputs">
            {questions.map((q, i) => (
              <li key={i}>
                <span className="n">{i + 1}</span>
                <input
                  className="input"
                  value={q}
                  aria-label={`Question ${i + 1}`}
                  onChange={(event) => setQuestion(i, event.target.value)}
                />
                <button
                  type="button"
                  className="btn quiet icon-only"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => removeQuestion(i)}
                  disabled={questions.length === 1 && !q}
                >
                  <Icon name="x" size={18} />
                </button>
              </li>
            ))}
          </ol>
          {questions.length < LIMITS.ownQuestions && (
            <button type="button" className="btn secondary sm" onClick={addQuestion}>
              <Icon name="plus" size={16} />
              Add a question
            </button>
          )}
        </div>

        {problem && (
          <div className="form-problem">
            <Notice tone="stop">{problem}</Notice>
          </div>
        )}
      </form>
    </Modal>
  )
}
