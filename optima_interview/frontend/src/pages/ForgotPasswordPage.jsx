import { Link } from 'react-router-dom'
import AuthFrame from '../components/AuthFrame'
import { Notice } from '../components/Bits'
import '../styles/auth.css'

// There is no password reset on the server yet, so this page says so instead of pretending to send an email.
export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      action={
        <Link to="/login" className="btn secondary sm">
          Log in
        </Link>
      }
    >
      <h1>Reset your password</h1>
      <p>Resetting a password by email is not available yet.</p>
      <div className="stack" style={{ marginTop: 24 }}>
        <Notice>
          Nothing has been sent, and nothing will be: this part of Optima has not been built. If you remember your
          password, you can still log in.
        </Notice>
        <Link to="/login" className="btn primary lg block">
          Back to log in
        </Link>
      </div>
    </AuthFrame>
  )
}
