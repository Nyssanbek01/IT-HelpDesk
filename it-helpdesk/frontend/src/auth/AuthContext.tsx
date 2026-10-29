import { createContext, useContext, useState, type ReactNode } from 'react'

export type AuthUser = {
  id: number
  name: string
  email: string
  role: string
}

type AuthContextValue = {
  token: string | null
  user: AuthUser | null
  setSession: (token: string, user: AuthUser) => void
  setUser: (user: AuthUser) => void
  clearSession: () => void
}

const TOKEN_KEY = 'it-helpdesk.token'
const USER_KEY = 'it-helpdesk.user'
const AuthContext = createContext<AuthContextValue | null>(null)

function readUser(): AuthUser | null {
  try {
    const value = localStorage.getItem(USER_KEY)
    return value ? JSON.parse(value) as AuthUser : null
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUserState] = useState<AuthUser | null>(readUser)

  function setSession(nextToken: string, nextUser: AuthUser) {
    localStorage.setItem(TOKEN_KEY, nextToken)
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    setToken(nextToken)
    setUserState(nextUser)
  }

  function setUser(nextUser: AuthUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    setUserState(nextUser)
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUserState(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, setSession, setUser, clearSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
