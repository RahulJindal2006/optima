import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { login, register } from '../api/client'
import AuthFrame from '../components/AuthFrame'
import { Field, Notice } from '../components/Bits'
import Choice from '../components/Choice'
import Combobox from '../components/Combobox'
import Icon from '../components/Icon'
import { PanelSent } from '../components/landing/Panels'
import { LIMITS } from '../lib/flags'
import { LOCATIONS } from '../lib/locations'
import { SEND_AT } from '../lib/score'
import '../styles/auth.css'

const ROLES = [
  { value: 'candidate', label: 'I’m looking for work' },
  { value: 'company', label: 'I’m hiring' },
]

// What happens after the account exists. Both lists are real sequences.
const NEXT = {
  candidate: [
    { title: 'Fill in your profile', text: 'Your skills and resume make up a quarter of every match score.' },
    { title: `Save up to ${LIMITS.savedRoles} roles`, text: 'Your weekly interview is built from the roles you save.' },
    {
      title: 'Take the weekly interview',
      text: `${LIMITS.weeklyQuestions} questions. Your application goes out wherever you score ${SEND_AT} or more.`,
    },
  ],
  company: [
    { title: 'Describe your company', text: 'A logo, a few lines about the work, and where you are.' },
    { title: 'Post a role', text: `Add up to ${LIMITS.ownQuestions} interview questions of your own.` },
    { title: 'Read the shortlist', text: 'Applicants arrive ranked, each with a score and the reasoning behind it.' },
  ],
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user, loading: checking, loginUser } = useAuth()
  const form = useRef(null)

  const signingUp = location.pathname === '/register'
  // The landing page links here with ?role=candidate or ?role=company.
  const role = params.get('role') === 'company' ? 'company' : 'candidate'

  const [values, setValues] = useState({
    first_name: '',
    last_name: '',
    company_name: '',
    company_location: '',
    email: '',
    password: '',
  })
  const [errors, setErrors] = useState({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  if (!checking && user) return <Navigate to="/dashboard" replace />

  const set = (key) => (event) => {
    const value = typeof event === 'string' ? event : event.target.value
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }))
  }

  const check = () => {
    const found = {}
    if (signingUp && role === 'candidate') {
      if (!values.first_name.trim()) found.first_name = 'Enter your first name.'
      if (!values.last_name.trim()) found.last_name = 'Enter your last name.'
    }
    if (signingUp && role === 'company' && !values.company_name.trim()) {
      found.company_name = 'Enter your company’s name.'
    }
    if (!EMAIL.test(values.email.trim())) found.email = 'Enter an email address, like name@example.com.'
    if (!values.password) found.password = 'Enter your password.'
    else if (signingUp && values.password.length < 8) found.password = 'Use at least 8 characters.'
    return found
  }

  const submit = async (event) => {
    event.preventDefault()
    setProblem('')
    const found = check()
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      form.current?.querySelector(`[name="${firstBad}"]`)?.focus()
      return
    }

    const email = values.email.toLowerCase().trim()
    let payload = { email, password: values.password }
    if (signingUp && role === 'candidate') {
      payload = { ...payload, role, first_name: values.first_name.trim(), last_name: values.last_name.trim() }
    } else if (signingUp) {
      payload = { ...payload, role, company_name: values.company_name.trim(), location: values.company_location.trim() }
    }

    setBusy(true)
    try {
      const session = signingUp ? await register(payload) : await login(payload)
      loginUser(session)
      navigate('/dashboard')
    } catch (err) {
      if (err.status === 409) setErrors({ email: 'An account with this email already exists.' })
      else setProblem(err.message)
      setBusy(false)
    }
  }

  const invalid = (key) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${key}-error` } : null)

  const side = signingUp ? (
    <>
      <h2>{role === 'company' ? 'From a new account to a shortlist' : 'From a new account to your first interview'}</h2>
      <ol className="next-steps">
        {NEXT[role].map((step, i) => (
          <li key={step.title}>
            <span className="n">{i + 1}</span>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </>
  ) : (
    <>
      <h2>One interview. Every role that fits.</h2>
      <div aria-hidden="true">
        <PanelSent />
      </div>
      <p className="side-note">Example data. A score of {SEND_AT} or more sends the application.</p>
    </>
  )

  return (
    <AuthFrame
      side={side}
      action={
        signingUp ? (
          <Link to="/login" className="btn secondary sm">
            Log in
          </Link>
        ) : (
          <Link to="/register" className="btn secondary sm">
            Create account
          </Link>
        )
      }
    >
      <h1>{signingUp ? 'Create your account' : 'Log in'}</h1>
      <p>
        {signingUp
          ? role === 'company'
            ? 'Post roles and read applicants ranked by how well they fit.'
            : 'Save roles, practise, and take one interview a week.'
          : 'Welcome back.'}
      </p>

      <form onSubmit={submit} noValidate ref={form}>
        {signingUp && (
          <Choice
            label="Account type"
            options={ROLES}
            value={role}
            onChange={(next) => {
              setErrors({})
              setParams(next === 'company' ? { role: 'company' } : { role: 'candidate' }, { replace: true })
            }}
          />
        )}

        {signingUp && role === 'candidate' && (
          <div className="auth-names">
            <Field label="First name" htmlFor="first_name" error={errors.first_name}>
              <input
                id="first_name"
                name="first_name"
                className="input"
                autoComplete="given-name"
                value={values.first_name}
                onChange={set('first_name')}
                {...invalid('first_name')}
              />
            </Field>
            <Field label="Last name" htmlFor="last_name" error={errors.last_name}>
              <input
                id="last_name"
                name="last_name"
                className="input"
                autoComplete="family-name"
                value={values.last_name}
                onChange={set('last_name')}
                {...invalid('last_name')}
              />
            </Field>
          </div>
        )}

        {signingUp && role === 'company' && (
          <>
            <Field label="Company name" htmlFor="company_name" error={errors.company_name}>
              <input
                id="company_name"
                name="company_name"
                className="input"
                autoComplete="organization"
                value={values.company_name}
                onChange={set('company_name')}
                {...invalid('company_name')}
              />
            </Field>
            <Field label="Location" htmlFor="company_location" optional>
              <Combobox
                id="company_location"
                name="company_location"
                options={LOCATIONS}
                value={values.company_location}
                onChange={set('company_location')}
                placeholder="Toronto, ON"
              />
            </Field>
          </>
        )}

        <Field label={signingUp && role === 'company' ? 'Work email' : 'Email'} htmlFor="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            inputMode="email"
            value={values.email}
            onChange={set('email')}
            {...invalid('email')}
          />
          {errors.email && signingUp && errors.email.includes('already exists') && (
            <p className="hint">
              <Link to="/login" className="link">
                Log in instead
              </Link>
            </p>
          )}
        </Field>

        <div className="field">
          <div className="auth-label-row">
            <label htmlFor="password">Password</label>
            {!signingUp && (
              <Link to="/forgot-password" className="link">
                Forgot password?
              </Link>
            )}
          </div>
          <div className="password">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              className="input"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              value={values.password}
              onChange={set('password')}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : signingUp ? 'password-hint' : undefined}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password ? (
            <p className="field-error" id="password-error">
              <Icon name="alert" size={16} />
              {errors.password}
            </p>
          ) : (
            signingUp && (
              <p className="hint" id="password-hint">
                At least 8 characters.
              </p>
            )
          )}
        </div>

        {problem && <Notice tone="stop">{problem}</Notice>}

        <button type="submit" className="btn primary lg block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {signingUp ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="auth-switch">
        {signingUp ? 'Already have an account? ' : 'New to Optima? '}
        <Link to={signingUp ? '/login' : '/register'} className="link">
          {signingUp ? 'Log in' : 'Create an account'}
        </Link>
      </p>
    </AuthFrame>
  )
}
