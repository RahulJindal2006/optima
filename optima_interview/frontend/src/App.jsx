import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Landing from './pages/Landing'

// Every page but the first loads when it is first visited.
const AuthPage = lazy(() => import('./pages/AuthPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const InterviewPage = lazy(() => import('./pages/InterviewPage'))
const ResultsPage = lazy(() => import('./pages/ResultsPage'))
const GradingRubric = lazy(() => import('./pages/GradingRubric'))
const CandidateProfile = lazy(() => import('./pages/CandidateProfile'))
const JobPostingsPage = lazy(() => import('./pages/JobPostingsPage'))
const InterviewHub = lazy(() => import('./pages/InterviewHub'))
const CompanyProfile = lazy(() => import('./pages/CompanyProfile'))
const CompanyJobs = lazy(() => import('./pages/CompanyJobs'))
const CompanyApplicants = lazy(() => import('./pages/CompanyApplicants'))

// Pages behind sign-in wait for the session check, then either show or send to /login.
// A page meant for the other kind of account sends the visitor to their own home page.
function ProtectedRoute({ children, role }) {
  const { user, loading, signedOutTo } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to={signedOutTo} replace />
  if (role && user.role !== role) return <Navigate to="/dashboard" replace />
  return children
}

// A new page starts at its top, the way a freshly loaded page would.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// Shorthand for the three kinds of page behind sign-in.
const signedIn = (page) => <ProtectedRoute>{page}</ProtectedRoute>
const candidate = (page) => <ProtectedRoute role="candidate">{page}</ProtectedRoute>
const company = (page) => <ProtectedRoute role="company">{page}</ProtectedRoute>

function App() {
  return (
    <Suspense fallback={null}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route path="/dashboard" element={signedIn(<Dashboard />)} />
        <Route path="/rubric" element={signedIn(<GradingRubric />)} />

        <Route path="/profile" element={candidate(<CandidateProfile />)} />
        <Route path="/job-postings" element={candidate(<JobPostingsPage />)} />
        <Route path="/interview-hub" element={candidate(<InterviewHub />)} />
        <Route path="/interview" element={candidate(<InterviewPage />)} />
        <Route path="/results/:sessionId" element={candidate(<ResultsPage />)} />

        <Route path="/company/profile" element={company(<CompanyProfile />)} />
        <Route path="/company/jobs" element={company(<CompanyJobs />)} />
        <Route path="/company/jobs/:jobId/applicants" element={company(<CompanyApplicants />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
