import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
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
  user: UserProfile
  message: string
}

type SessionOption = {
  id: string
  name: string
  queueCount: number
  status: 'active' | 'upcoming'
}

const MOCK_SESSIONS: SessionOption[] = [
  { id: 'session-001', name: 'Friday Karaoke Night', queueCount: 12, status: 'active' },
  { id: 'session-002', name: 'Saturday Pop Hits', queueCount: 8, status: 'upcoming' },
  { id: 'session-003', name: 'Sunday OPM Chill', queueCount: 4, status: 'upcoming' },
]

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin
const API_ROOT =
  API_BASE_URL.endsWith('/api') || API_BASE_URL.endsWith('/api/')
    ? API_BASE_URL.replace(/\/$/, '')
    : `${API_BASE_URL.replace(/\/$/, '')}/api`

function App() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('password')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [loggedInUser, setLoggedInUser] = useState<UserProfile | null>(null)

  const selectedSession = useMemo(
    () => MOCK_SESSIONS.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId],
  )

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_ROOT}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null
        throw new Error(errorPayload?.detail ?? 'Login failed')
      }

      const payload = (await response.json()) as LoginResponse
      setLoggedInUser(payload.user)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unexpected error during login'
      setErrorMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = async () => {
    if (loggedInUser === null) {
      return
    }

    await fetch(`${API_ROOT}/users/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loggedInUser.username }),
    })

    setSelectedSessionId(null)
    setLoggedInUser(null)
  }

  if (loggedInUser === null) {
    return (
      <main className="app-shell">
        <section className="card">
          <h1>Singalong Admin</h1>

          <form className="form" onSubmit={handleLogin}>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
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
                onChange={(event) => setPassword(event.target.value)}
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

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Session Selection</h1>
            <p className="subtitle">
              Welcome, <strong>{loggedInUser.username}</strong> ({loggedInUser.role})
            </p>
          </div>
          <button type="button" className="secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>

        <ul className="session-list">
          {MOCK_SESSIONS.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className={`session-item ${
                  selectedSessionId === session.id ? 'selected' : ''
                }`}
                onClick={() => setSelectedSessionId(session.id)}
              >
                <span className="session-name">{session.name}</span>
                <span className="session-meta">
                  {session.status.toUpperCase()} · {session.queueCount} queued songs
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="selection-summary">
          {selectedSession === null ? (
            <p>Select a session from the list to continue.</p>
          ) : (
            <p>
              Selected session: <strong>{selectedSession.name}</strong>
            </p>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
