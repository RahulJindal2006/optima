// Small helpers shared by the app pages.

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Uploaded files come back either as a full address (cloud storage) or as a path on the API server.
export function fileUrl(path) {
  if (!path) return null
  if (/^(https?:|blob:|data:)/.test(path)) return path
  return `${API_BASE}${path}`
}

// "resumes/resume_12.pdf" -> "resume_12.pdf"
export function fileName(path) {
  if (!path) return ''
  return decodeURIComponent(String(path).split('?')[0].split('/').pop() || '')
}

// The API sends times in UTC without saying so. Read them as UTC.
export function parseTime(value) {
  if (!value) return null
  const text = String(value)
  const date = new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const DAY = { weekday: 'short', month: 'short', day: 'numeric' }
const FULL = { month: 'short', day: 'numeric', year: 'numeric' }

export function formatDay(value) {
  const date = parseTime(value)
  return date ? date.toLocaleDateString('en-CA', DAY) : ''
}

export function formatDate(value) {
  const date = parseTime(value)
  return date ? date.toLocaleDateString('en-CA', FULL) : ''
}

// A plain calendar date such as "2026-05-04" (no time, no zone).
export function formatPlainDate(value) {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (!m) return String(value)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-CA', FULL)
}

export function daysUntil(value) {
  const date = parseTime(value)
  if (!date) return null
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000))
}

function money(n) {
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
}

export function formatSalary(min, max) {
  if (!min && !max) return ''
  if (min && max) return min === max ? money(min) : `${money(min)} to ${money(max)}`
  return min ? `From ${money(min)}` : `Up to ${money(max)}`
}

export const LOCATION_TYPES = [
  { value: 'onsite', label: 'On site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
]

export const HOURS_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
]

export const LEVELS = [
  { value: 'internship', label: 'Internship' },
  { value: 'entry', label: 'Entry level' },
  { value: 'senior', label: 'Senior' },
]

export const labelOf = (list, value) => list.find((item) => item.value === value)?.label || value || ''

// "4" -> "4 months". Older postings may hold free text, which is shown as written.
export function formatTerm(value) {
  if (!value) return ''
  const text = String(value).trim()
  return /^\d+$/.test(text) ? `${text} ${text === '1' ? 'month' : 'months'}` : text
}

// The short facts shown under a role's title.
export function jobFacts(job) {
  const facts = [
    job.location,
    labelOf(LOCATION_TYPES, job.location_type),
    labelOf(HOURS_TYPES, job.hours_type),
    labelOf(LEVELS, job.job_level),
    formatSalary(job.salary_min, job.salary_max),
  ].filter(Boolean)
  // "Remote" as the place and "Remote" as the arrangement is one fact, not two.
  return facts.filter((fact, i) => facts.findIndex((f) => f.toLowerCase() === fact.toLowerCase()) === i)
}

export function initials(name) {
  return (
    String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

export const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What an application's status means to each side.
export const STATUS_FOR_CANDIDATE = {
  applied: 'Sent',
  viewed: 'Viewed',
  contacted: 'Contacted',
  withdrawn: 'Withdrawn',
}

export const STATUS_FOR_COMPANY = {
  applied: 'New',
  viewed: 'Viewed',
  contacted: 'Contacted',
  withdrawn: 'Withdrawn',
}
