import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'

// The top bar on pages people see before they sign in.
// `links` point at sections of the current page; the one in view is marked.
export default function PublicNav({ links = [] }) {
  const { user } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState(null)

  useEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      setScrolled(window.scrollY > 4)
      const mark = window.innerHeight * 0.4
      let current = null
      for (const link of links) {
        const section = document.getElementById(link.href.slice(1))
        if (!section) continue
        const rect = section.getBoundingClientRect()
        if (rect.top <= mark && rect.bottom > mark) current = link.href
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [links])

  return (
    <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="wrap topbar-in">
        <Link to="/" className="topbar-logo" aria-label="Optima, home">
          <Logo />
        </Link>
        {links.length > 0 && (
          <nav className="topbar-links page-links" aria-label="On this page">
            {links.map((l) => (
              <a key={l.href} href={l.href} aria-current={active === l.href ? 'true' : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
        )}
        <div className="topbar-actions">
          {user ? (
            <Link to="/dashboard" className="btn primary sm">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn quiet sm">
                Log in
              </Link>
              <Link to="/register" className="btn primary sm">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
