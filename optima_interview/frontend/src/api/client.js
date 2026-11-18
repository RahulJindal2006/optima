const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

// Turns an error response into one sentence a person can read.
// FastAPI sends `detail` as text for its own errors and as a list for failed validation.
function messageFrom(body, status) {
  const detail = body?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item) => String(item?.msg || '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join(' ')
  }
  return `Request failed (${status}).`
}

async function send(path, options, hadToken) {
  let res
  try {
    res = await fetch(`${API}${path}`, options)
  } catch {
    // no reply at all: the connection is down, or something between here and the server dropped the request
    throw Object.assign(new Error(OFFLINE), { noReply: true })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(messageFrom(body, res.status))
    err.status = res.status
    // A rejected token means the session is over: tell the app so it can show the log-in page.
    if (res.status === 401 && hadToken) window.dispatchEvent(new Event('optima:signed-out'))
    throw err
  }

  // 204 No Content
  if (res.status === 204) return null
  return res.json()
}

function request(path, options = {}) {
  const token = localStorage.getItem('nexus_token')
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return send(path, { ...options, headers }, Boolean(token))
}

// One file, sent as multipart form data.
function upload(path, file) {
  const token = localStorage.getItem('nexus_token')
  const form = new FormData()
  form.append('file', file)
  return send(path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }, Boolean(token))
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const register = (data) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify(data) })

export const login = (data) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify(data) })

export const getMe = () => request('/auth/me')

// ── Profile ───────────────────────────────────────────────────────────────────
export const getMyProfile = () => request('/profile/me')

export const updateMyProfile = (data) =>
  request('/profile/me', { method: 'PATCH', body: JSON.stringify(data) })

export const getCandidateProfile = (userId) => request(`/profile/${userId}`)

/** Upload a profile picture or company logo. */
export const uploadAvatar = (file) => upload('/profile/avatar', file)

/** Upload a resume (PDF). */
export const uploadResume = (file) => upload('/profile/resume', file)

// ── Interviews ────────────────────────────────────────────────────────────────
export const getIndustries = () => request('/interviews/industries')

export const getRolesForIndustry = (industry) =>
  request(`/interviews/roles?industry=${encodeURIComponent(industry)}`)

export const canStartConnecting = () => request('/interviews/can-connect')

const post = (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) })

/** Write the questions. None is shown until `beginInterview`. Asking again before Begin returns the same interview. */
export const startInterview = (data) => post('/interviews/start', data)

/** Show the first question and start its clock. `attempt` is a key this page made up: no other page can continue. */
export const beginInterview = (sessionId, attempt) => post(`/interviews/${sessionId}/begin`, { attempt })

/** Send one answer: { attempt, question_id, answer, signals }. The reply carries the next question, or none. */
export const answerQuestion = (sessionId, body) => post(`/interviews/${sessionId}/answer`, body)

/** Tell the server the candidate left the window, came back, or tried to paste: { attempt, type, how, ms }. */
export const reportEvent = (sessionId, body) => post(`/interviews/${sessionId}/event`, body)

/** Say the interview page is still open. The reply carries the server's clock. */
export const checkIn = (sessionId, attempt) => post(`/interviews/${sessionId}/ping`, { attempt })

/** Score the interview once every question is answered: { attempt, delivery }. */
export const finishInterview = (sessionId, body = {}) => post(`/interviews/${sessionId}/finish`, body)

/** Leave an interview part-way. A weekly interview left this way scores 0. */
export const abandonInterview = (sessionId) => post(`/interviews/${sessionId}/abandon`)

/**
 * The same, sent as the page closes. A closing page can only send a plain body (a "beacon"), which the
 * browser delivers after the page is gone, so the sign-in token travels as the body.
 */
export const abandonOnClose = (sessionId) => {
  const token = localStorage.getItem('nexus_token')
  if (!token) return
  const url = `${API}/interviews/${sessionId}/closed`
  try {
    if (navigator.sendBeacon?.(url, token)) return
    fetch(url, { method: 'POST', keepalive: true, body: token }).catch(() => {})
  } catch {
    // nothing more can be done from a closing page
  }
}

export const getResults = (sessionId) => request(`/interviews/${sessionId}/results`)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CUT_OFF = 'Scoring was cut off before it finished. Your answers are saved: try again in a moment.'
const CUT_OFFS_ALLOWED = 3
const SHORT_TURN_SECONDS = 8

/**
 * Have an interview scored, however many requests that takes. The server saves the scoring as it goes:
 * one request works for under a minute, then says whether there is more to do (`awaiting_scoring`).
 * Resolves with the results. Rejects with the server's refusal: a 502 means the grader is failing,
 * the answers are safe, and asking again later carries on from what is already scored.
 * `alive` lets a page that has gone away stop the asking.
 *
 * A host with a time limit shorter than a scoring request stops it part-way. The page sees that as a
 * 504, or as no reply at all when the host's own error page comes from another address. What had been
 * scored is saved, so the page looks in on the results and asks again, for shorter turns, a few times
 * before giving up. If the connection really is down, looking in fails and that is what the page says.
 */
export async function scoreInterview(sessionId, body = {}, alive = () => true) {
  let ask = body
  let cutOffs = 0
  for (let asked = 0; asked < 60 && alive(); asked += 1) {
    try {
      const result = await finishInterview(sessionId, ask)
      if (!result.awaiting_scoring) return result
    } catch (err) {
      if (err.status === 504 || err.noReply) {
        cutOffs += 1
        if (cutOffs > CUT_OFFS_ALLOWED) throw Object.assign(new Error(CUT_OFF), { status: 504 })
        ask = { ...body, budget_seconds: SHORT_TURN_SECONDS }
      } else if (err.status !== 409) {
        throw err
      }
      // 409: another request is scoring it right now. Either way, look in on it before asking again.
      await wait(4000)
      const result = await getResults(sessionId)
      if (!result.awaiting_scoring) return result
    }
  }
  throw new Error('Scoring is taking longer than expected. Your answers are saved: open the results again in a minute.')
}

export const getMySessions = () => request('/interviews/')

// ── Scoring ───────────────────────────────────────────────────────────────────
/** The scorecard, weights and rules, exactly as the server applies them. */
export const getRubric = () => request('/scoring/rubric')

/** The owner's check of the grader. `key` is the ADMIN_KEY set on the server; it is sent with each request and kept nowhere. */
export const getScoringCheck = (key) => request('/scoring/check', { headers: { 'X-Admin-Key': key } })

/** Grade one reference answer afresh, `runs` times. Each run makes real calls to Claude. */
export const runScoringCheck = (key, body) =>
  request('/scoring/check/run', { method: 'POST', headers: { 'X-Admin-Key': key }, body: JSON.stringify(body) })

// ── Jobs ──────────────────────────────────────────────────────────────────────
export const listJobs = (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.industry)      params.set('industry', filters.industry)
  if (filters.location_type && filters.location_type !== 'any') params.set('location_type', filters.location_type)
  if (filters.hours_type && filters.hours_type !== 'any')       params.set('hours_type', filters.hours_type)
  if (filters.job_level)     params.set('job_level', filters.job_level)
  if (filters.salary_min)    params.set('salary_min', filters.salary_min)
  if (filters.salary_max)    params.set('salary_max', filters.salary_max)
  if (filters.start_date)    params.set('start_date', filters.start_date)
  if (filters.work_term)     params.set('work_term', filters.work_term)
  const qs = params.toString()
  return request(`/jobs/${qs ? '?' + qs : ''}`)
}

export const getMyJobs = () => request('/jobs/mine')

export const getPastJobs = () => request('/jobs/mine/past')

export const createJob = (data) =>
  request('/jobs/', { method: 'POST', body: JSON.stringify(data) })

export const updateJob = (jobId, data) =>
  request(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const getJob = (jobId) => request(`/jobs/${jobId}`)

// ── Favourites ────────────────────────────────────────────────────────────────
export const getFavourites = () => request('/favourites/')

export const addFavourite = (jobId) =>
  request(`/favourites/${jobId}`, { method: 'POST' })

export const removeFavourite = (jobId) =>
  request(`/favourites/${jobId}`, { method: 'DELETE' })

// ── Applications ──────────────────────────────────────────────────────────────
export const getMyApplications = () => request('/applications/mine')

export const getApplicationsForSession = (sessionId) =>
  request(`/applications/mine/session/${sessionId}`)

export const updateApplication = (applicationId, data) =>
  request(`/applications/${applicationId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const withdrawApplication = (applicationId) =>
  request(`/applications/${applicationId}/withdraw`, { method: 'POST' })

export const getApplicantsForJob = (jobId) =>
  request(`/applications/for-job/${jobId}`)

export const updateApplicationStatus = (applicationId, newStatus) =>
  request(`/applications/${applicationId}/status?new_status=${newStatus}`, { method: 'PATCH' })

export const uploadTailoredResume = (applicationId, file) =>
  upload(`/applications/${applicationId}/upload-resume`, file)

export const uploadCoverLetter = (applicationId, file) =>
  upload(`/applications/${applicationId}/upload-cover`, file)

// ── TTS ───────────────────────────────────────────────────────────────────────
/** Calls the TTS endpoint and returns a blob URL for the audio. Caller must revoke it after use. */
export const speakText = async (text) => {
  const token = localStorage.getItem('nexus_token')
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API}/tts/speak`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error('TTS unavailable')
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ── Matches ───────────────────────────────────────────────────────────────────
export const getMatches = (jobId) =>
  request(`/matches/${jobId ? `?job_id=${jobId}` : ''}`)

export const getMyMatches = () => request('/matches/mine')

export const updateMatchStatus = (matchId, newStatus) =>
  request(`/matches/${matchId}/status?new_status=${newStatus}`, { method: 'PATCH' })
