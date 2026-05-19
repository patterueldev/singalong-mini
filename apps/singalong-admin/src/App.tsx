import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import './App.css'

type UserRole = 'admin' | 'guest' | 'player'

type UserProfile = {
  id: string
  username: string
  role: UserRole
  created_at: string
  updated_at: string
}

type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
  message: string
}

type SessionRecord = {
  id: string
  session_code: string
  name: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

type SessionArchiveResponse = {
  session: SessionRecord
  message: string
}

type StoredAuth = {
  accessToken: string
  user: UserProfile
}

const AUTH_STORAGE_KEY = 'singalong-admin-auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin
const API_ROOT =
  API_BASE_URL.endsWith('/api') || API_BASE_URL.endsWith('/api/')
    ? API_BASE_URL.replace(/\/$/, '')
    : `${API_BASE_URL.replace(/\/$/, '')}/api`

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function readStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken !== '' &&
      typeof parsed.user?.username === 'string'
    ) {
      return {
        accessToken: parsed.accessToken,
        user: parsed.user as UserProfile,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY)
  return null
}

function saveStoredAuth(auth: StoredAuth) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
}

function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}

function authHeaders(token?: string): HeadersInit {
  if (token === undefined) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  if (token !== undefined) {
    const bearerHeaders = authHeaders(token)
    Object.entries(bearerHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })
  }

  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null
    throw new ApiError(payload?.detail ?? 'Request failed', response.status)
  }

  return response.json() as Promise<T>
}

function LoadingView() {
  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Admin</h1>
        <p className="subtitle">Restoring session...</p>
      </section>
    </main>
  )
}

type LoginPageProps = {
  username: string
  password: string
  errorMessage: string
  isSubmitting: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function LoginPage({
  username,
  password,
  errorMessage,
  isSubmitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginPageProps) {
  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Admin</h1>
        <p className="subtitle">Login to manage karaoke sessions.</p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </label>

          {errorMessage !== '' ? (
            <p className="error-message" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}

type SessionsPageProps = {
  user: UserProfile
  sessions: SessionRecord[]
  newSessionName: string
  isLoadingSessions: boolean
  isSavingSession: boolean
  sessionMessage: string
  errorMessage: string
  onLogout: () => void
  onRefresh: () => void
  onSessionNameChange: (value: string) => void
  onCreateSession: (event: FormEvent<HTMLFormElement>) => void
  onArchiveSession: (sessionId: string) => void
}

function SessionsPage({
  user,
  sessions,
  newSessionName,
  isLoadingSessions,
  isSavingSession,
  sessionMessage,
  errorMessage,
  onLogout,
  onRefresh,
  onSessionNameChange,
  onCreateSession,
  onArchiveSession,
}: SessionsPageProps) {
  const activeCount = useMemo(
    () => sessions.filter((session) => session.archived_at === null).length,
    [sessions],
  )

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Session Management</h1>
            <p className="subtitle">
              Welcome, <strong>{user.username}</strong> ({user.role})
            </p>
          </div>
          <button type="button" className="secondary" onClick={onLogout}>
            Logout
          </button>
        </div>

        <div className="metrics">
          <div>
            <span className="metric-label">Total sessions</span>
            <strong>{sessions.length}</strong>
          </div>
          <div>
            <span className="metric-label">Active sessions</span>
            <strong>{activeCount}</strong>
          </div>
        </div>

        <form className="form inline-form" onSubmit={onCreateSession}>
          <label>
            New session name
            <input
              value={newSessionName}
              onChange={(event) => onSessionNameChange(event.target.value)}
              placeholder="Friday Karaoke Night"
              required
            />
          </label>
          <button type="submit" disabled={isSavingSession}>
            {isSavingSession ? 'Creating…' : 'Create session'}
          </button>
        </form>

        {sessionMessage !== '' ? <p className="success-message">{sessionMessage}</p> : null}
        {errorMessage !== '' ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="list-header">
          <h2>Sessions</h2>
          <button type="button" className="secondary" onClick={onRefresh} disabled={isLoadingSessions}>
            {isLoadingSessions ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <p className="empty-state">No sessions yet.</p>
          ) : (
            sessions.map((session) => {
              const isActive = session.archived_at === null
              return (
                <article className="session-row" key={session.id}>
                  <div>
                    <div className="session-title">
                      <strong>{session.name}</strong>
                      <span className={`badge ${isActive ? 'active' : 'inactive'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="session-meta">
                      Code: <code>{session.session_code}</code> · Created{' '}
                      {new Date(session.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!isActive}
                    onClick={() => onArchiveSession(session.id)}
                  >
                    {isActive ? 'Mark inactive' : 'Archived'}
                  </button>
                </article>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}

function AppShell() {
  const [auth, setAuth] = useState<StoredAuth | null>(null)
  const [isHydratingAuth, setIsHydratingAuth] = useState(true)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('password')
  const [loginErrorMessage, setLoginErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isSavingSession, setIsSavingSession] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')

  const loadSessions = useCallback(async (token: string) => {
    setIsLoadingSessions(true)
    setSessionErrorMessage('')
    try {
      const payload = await apiJson<SessionRecord[]>('/sessions', {}, token)
      setSessions(payload)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        setSessions([])
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error loading sessions'
      setSessionErrorMessage(message)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    const storedAuth = readStoredAuth()
    if (storedAuth === null) {
      setIsHydratingAuth(false)
      return
    }

    let cancelled = false

    const hydrate = async () => {
      try {
        const user = await apiJson<UserProfile>('/users/me', {}, storedAuth.accessToken)
        if (cancelled) {
          return
        }

        const nextAuth = { accessToken: storedAuth.accessToken, user }
        saveStoredAuth(nextAuth)
        setAuth(nextAuth)
      } catch {
        clearStoredAuth()
        if (!cancelled) {
          setAuth(null)
        }
      } finally {
        if (!cancelled) {
          setIsHydratingAuth(false)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (auth === null) {
      setSessions([])
      return
    }

    void loadSessions(auth.accessToken)
  }, [auth, loadSessions])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginErrorMessage('')
    setIsSubmitting(true)

    try {
      const payload = await apiJson<LoginResponse>('/users/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })

      const nextAuth = {
        accessToken: payload.access_token,
        user: payload.user,
      }
      saveStoredAuth(nextAuth)
      setAuth(nextAuth)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error during login'
      setLoginErrorMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = async () => {
    if (auth === null) {
      return
    }

    try {
      await apiJson<{ message: string }>('/users/logout', {
        method: 'POST',
        body: JSON.stringify({ username: auth.user.username }),
      }, auth.accessToken)
    } catch {
      // Logout is best-effort; local auth state still clears.
    } finally {
      clearStoredAuth()
      setAuth(null)
      setSessions([])
      setNewSessionName('')
      setSessionMessage('')
      setSessionErrorMessage('')
      setLoginErrorMessage('')
    }
  }

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (auth === null) {
      return
    }

    setSessionMessage('')
    setSessionErrorMessage('')
    setIsSavingSession(true)

    try {
      await apiJson<SessionRecord>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: newSessionName }),
      }, auth.accessToken)

      setNewSessionName('')
      setSessionMessage('Session created.')
      await loadSessions(auth.accessToken)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error creating session'
      setSessionErrorMessage(message)
    } finally {
      setIsSavingSession(false)
    }
  }

  const handleArchiveSession = async (sessionId: string) => {
    if (auth === null) {
      return
    }

    setSessionMessage('')
    setSessionErrorMessage('')

    try {
      const payload = await apiJson<SessionArchiveResponse>(`/sessions/${sessionId}/archive`, {
        method: 'PATCH',
      }, auth.accessToken)

      setSessionMessage(`${payload.session.session_code} archived.`)
      await loadSessions(auth.accessToken)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error archiving session'
      setSessionErrorMessage(message)
    }
  }

  if (isHydratingAuth) {
    return <LoadingView />
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={auth === null ? '/login' : '/sessions'} replace />}
        />
        <Route
          path="/login"
          element={
            auth !== null ? (
              <Navigate to="/sessions" replace />
            ) : (
              <LoginPage
                username={username}
                password={password}
                errorMessage={loginErrorMessage}
                isSubmitting={isSubmitting}
                onUsernameChange={setUsername}
                onPasswordChange={setPassword}
                onSubmit={handleLogin}
              />
            )
          }
        />
        <Route
          path="/sessions"
          element={
            auth === null ? (
              <Navigate to="/login" replace />
            ) : (
              <SessionsPage
                user={auth.user}
                sessions={sessions}
                newSessionName={newSessionName}
                isLoadingSessions={isLoadingSessions}
                isSavingSession={isSavingSession}
                sessionMessage={sessionMessage}
                errorMessage={sessionErrorMessage}
                onLogout={handleLogout}
                onRefresh={() => {
                  void loadSessions(auth.accessToken)
                }}
                onSessionNameChange={setNewSessionName}
                onCreateSession={handleCreateSession}
                onArchiveSession={handleArchiveSession}
              />
            )
          }
        />
        <Route
          path="*"
          element={<Navigate to={auth === null ? '/login' : '/sessions'} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default AppShell
