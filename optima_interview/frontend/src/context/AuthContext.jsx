import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getMe } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Nothing to wait for when there is no saved session.
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('nexus_token')))
  // Where a signed-out visitor is sent from a page that needs an account: the landing page after
  // choosing "Log out", the log-in page otherwise (first visit, or a session the server ended).
  const [signedOutTo, setSignedOutTo] = useState('/login')

  useEffect(() => {
    if (!localStorage.getItem('nexus_token')) return
    getMe()
      .then(setUser)
      .catch(() => localStorage.removeItem('nexus_token'))
      .finally(() => setLoading(false))
  }, [])

  const loginUser = useCallback((tokenResponse) => {
    localStorage.setItem('nexus_token', tokenResponse.access_token)
    setSignedOutTo('/login')
    setUser(tokenResponse.user)
  }, [])

  const logout = useCallback((to = '/login') => {
    localStorage.removeItem('nexus_token')
    setSignedOutTo(to)
    setUser(null)
  }, [])

  // Keeps the name and picture in the top bar in step after a profile change.
  const updateUser = useCallback((changes) => {
    setUser((current) => (current ? { ...current, ...changes } : current))
  }, [])

  // The API client raises this when the server no longer accepts the saved session.
  useEffect(() => {
    const ended = () => logout('/login')
    window.addEventListener('optima:signed-out', ended)
    return () => window.removeEventListener('optima:signed-out', ended)
  }, [logout])

  const value = useMemo(
    () => ({ user, loading, signedOutTo, loginUser, logout, updateUser }),
    [user, loading, signedOutTo, loginUser, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
