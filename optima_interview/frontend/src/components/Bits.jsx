// Small pieces used on most pages.
import { useState } from 'react'
import Icon from './Icon'
import { fileUrl, initials } from '../lib/format'

export function Notice({ tone = '', icon, title, children, role }) {
  const name = icon || (tone === 'stop' ? 'alert' : tone === 'go' ? 'check' : 'info')
  return (
    <div className={`notice ${tone}`} role={role || (tone === 'stop' ? 'alert' : undefined)}>
      <Icon name={name} size={18} />
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Loading({ children = 'Loading' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </div>
  )
}

// A picture if there is one, initials if not.
export function Avatar({ name, src, size = '', square = false }) {
  const [broken, setBroken] = useState(false)
  const url = broken ? null : fileUrl(src)
  return (
    <span className={`avatar ${size} ${square ? 'square' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  )
}

// Short facts on one line, separated by thin rules.
export function Facts({ items, className = '' }) {
  if (!items?.length) return null
  return (
    <ul className={`facts ${className}`}>
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  )
}

export function Skills({ items }) {
  if (!items?.length) return null
  return (
    <ul className="skills">
      {items.map((item, i) => (
        <li className="chip" key={`${item}-${i}`}>
          {item}
        </li>
      ))}
    </ul>
  )
}

// A label with its control, and a hint or an error under it.
export function Field({ label, htmlFor, optional, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {optional && <span className="opt"> (optional)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined}>
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : (
        hint && (
          <p className="hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

// A document someone uploaded: open it in a new tab, or look at it here.
export function FileLine({ href, label, sub, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fileline">
      <div className="fileline-row">
        <span className="fileline-icon">
          <Icon name="file" />
        </span>
        <span className="fileline-text">
          <strong>{label}</strong>
          {sub && <span>{sub}</span>}
        </span>
        <span className="fileline-actions">
          {href && (
            <>
              <button type="button" className="btn quiet sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? 'Hide preview' : 'Preview'}
              </button>
              <a className="btn secondary sm" href={href} target="_blank" rel="noreferrer">
                Open
                <Icon name="external" size={16} />
              </a>
            </>
          )}
          {children}
        </span>
      </div>
      {open && href && (
        <object className="fileline-view" data={href} type="application/pdf" aria-label={label}>
          <p className="hint">This browser cannot show the PDF here. Use Open to see it in a new tab.</p>
        </object>
      )}
    </div>
  )
}
