import { Link } from 'react-router-dom'
import Logo from './Logo'

// The frame for log in, sign up and password pages: a quiet top bar, the form, and a side panel.
export default function AuthFrame({ action, children, side }) {
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link to="/" className="topbar-logo" aria-label="Optima, home">
            <Logo />
          </Link>
          {action && <div className="topbar-actions">{action}</div>}
        </div>
      </header>
      <main id="main" className={`wrap auth ${side ? '' : 'solo'}`}>
        <div className="auth-form">{children}</div>
        {side && <aside className="auth-side">{side}</aside>}
      </main>
    </div>
  )
}
