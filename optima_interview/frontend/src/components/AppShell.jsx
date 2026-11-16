import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Bits'
import Icon from './Icon'
import Logo from './Logo'

const LINKS = {
  candidate: [
    { to: '/dashboard', label: 'Home' },
    { to: '/job-postings', label: 'Jobs' },
    { to: '/interview-hub', label: 'Interviews' },
    { to: '/profile', label: 'Profile' },
  ],
  company: [
    { to: '/dashboard', label: 'Home' },
    { to: '/company/jobs', label: 'Roles' },
    { to: '/company/profile', label: 'Company' },
  ],
}

// The top bar once someone is signed in.
function AppNav() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const menu = useRef(null)
  const links = LINKS[user?.role] || []

  // Close the menu when the page changes, on Escape, and on a click anywhere else.
  const [seenPath, setSeenPath] = useState(location.pathname)
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (menu.current && !menu.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Signing out sends the visitor to the landing page (see AuthContext).
  const signOut = () => logout('/')

  return (
    <header className="topbar ruled">
      <div className="wrap topbar-in">
        <Link to="/dashboard" className="topbar-logo" aria-label="Optima, home">
          <Logo />
        </Link>

        <nav className="topbar-links app-links" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions account" ref={menu}>
          <button
            type="button"
            className="account-button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Avatar name={user?.name} src={user?.profile_picture_url} size="sm" square={user?.role === 'company'} />
            <span className="account-name">{user?.name}</span>
            <Icon name="chevron-down" size={16} className="account-chev" />
            <Icon name="menu" className="account-burger" />
            <span className="sr-only">Menu</span>
          </button>

          {open && (
            <div className="menu" role="menu">
              <div className="menu-who">
                <strong>{user?.name}</strong>
                <span>{user?.email}</span>
              </div>
              <div className="menu-links">
                {links.map((link) => (
                  <NavLink key={link.to} to={link.to} role="menuitem">
                    {link.label}
                  </NavLink>
                ))}
              </div>
              <NavLink to="/rubric" role="menuitem">
                How scoring works
              </NavLink>
              <button type="button" role="menuitem" onClick={signOut}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// The frame for every signed-in page.
export default function AppShell({ children, narrow = false }) {
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <AppNav />
      <main id="main" className={`wrap page ${narrow ? 'narrow' : ''}`}>
        {children}
      </main>
    </div>
  )
}

// A page's title, one line about it, and its main action.
export function PageHead({ title, children, action, back }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link to={back.to} className="page-back">
            <Icon name="arrow-left" size={18} />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </div>
  )
}
