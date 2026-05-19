import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
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

type SongQueueItem = {
  id: string
  title: string
  artist: string
  status: string
}

type PlaybackState = {
  isPlaying: boolean
  positionSeconds: number
}

type StoredAuth = {
  accessToken: string
  user: UserProfile
}

type WSIncoming = {
  type: string
  session_code: string
  payload: Record<string, unknown>
}

const AUTH_STORAGE_KEY = 'singalong-admin-auth'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin
const API_ROOT =
  API_BASE_URL.endsWith('/api') || API_BASE_URL.endsWith('/api/')
    ? API_BASE_URL.replace(/\/$/, '')
    : `${API_BASE_URL.replace(/\/$/, '')}/api`
const HTTP_BASE = API_ROOT.replace(/\/api$/, '')
const WS_BASE = HTTP_BASE.replace(/^http/i, 'ws')

const INITIAL_MOCK_QUEUE: SongQueueItem[] = [
  { id: 'mock-1', title: 'Bohemian Rhapsody', artist: 'Queen', status: 'queued' },
  { id: 'mock-2', title: 'Dancing Queen', artist: 'ABBA', status: 'queued' },
]

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

function buildWSUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return `${WS_BASE}${path}?${query}`
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
  const navigate = useNavigate()
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
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!isActive}
                      onClick={() => navigate(`/sessions/${session.session_code}`)}
                    >
                      Open controls
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!isActive}
                      onClick={() => onArchiveSession(session.id)}
                    >
                      {isActive ? 'Mark inactive' : 'Archived'}
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}

type SessionControlPageProps = {
  auth: StoredAuth
  sessions: SessionRecord[]
  onRefreshSessions: () => void
  onArchiveSession: (sessionId: string) => void
}

function SessionControlPage({
  auth,
  sessions,
  onRefreshSessions,
  onArchiveSession,
}: SessionControlPageProps) {
  const navigate = useNavigate()
  const params = useParams<{ sessionCode: string }>()
  const sessionCode = params.sessionCode ?? ''
  const [socketStatus, setSocketStatus] = useState('Connecting...')
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>(INITIAL_MOCK_QUEUE)
  const [downloadsCount, setDownloadsCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    positionSeconds: 0,
  })
  const [wsMessage, setWsMessage] = useState('')
  const socketRef = useRef<WebSocket | null>(null)

  const session = useMemo(
    () =>
      sessions.find(
        (entry) =>
          entry.session_code === sessionCode && entry.archived_at === null,
      ) ?? null,
    [sessionCode, sessions],
  )

  const sendCommand = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const socket = socketRef.current
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      setWsMessage('WebSocket is not connected.')
      return
    }

    socket.send(
      JSON.stringify({
        type,
        session_code: sessionCode,
        payload,
      }),
    )
  }, [sessionCode])

  useEffect(() => {
    if (session === null) {
      setSocketStatus('Session not found or inactive.')
      return
    }

    const wsUrl = buildWSUrl('/ws/admin', {
      session_code: session.session_code,
      token: auth.accessToken,
    })
    const socket = new WebSocket(wsUrl)
    socketRef.current = socket

    socket.onopen = () => {
      setSocketStatus('Connected')
      setWsMessage('')
      onRefreshSessions()
    }

    socket.onclose = () => {
      setSocketStatus('Disconnected')
    }

    socket.onerror = () => {
      setSocketStatus('Connection error')
    }

    socket.onmessage = (event) => {
      let payload: WSIncoming
      try {
        payload = JSON.parse(event.data) as WSIncoming
      } catch {
        return
      }

      if (payload.type === 'queue.updated') {
        const items = payload.payload.items
        if (Array.isArray(items)) {
          setQueueItems(items as SongQueueItem[])
        }
        return
      }

      if (payload.type === 'downloads.updated') {
        const items = payload.payload.items
        if (Array.isArray(items)) {
          setDownloadsCount(items.length)
        }
        return
      }

      if (payload.type === 'playback.position') {
        const nextPosition = Number(payload.payload.position_seconds ?? 0)
        setPlaybackState((previous) => ({
          ...previous,
          positionSeconds: Number.isFinite(nextPosition) ? nextPosition : previous.positionSeconds,
        }))
        return
      }

      if (payload.type === 'playback.ended') {
        setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
        setWsMessage('Player reported playback ended.')
        return
      }

      if (payload.type === 'session.ended') {
        setWsMessage('Session ended. Returning to sessions.')
        onRefreshSessions()
        setTimeout(() => navigate('/sessions'), 500)
        return
      }

      if (payload.type === 'error') {
        const message = payload.payload.message
        if (typeof message === 'string') {
          setWsMessage(message)
        }
      }
    }

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [auth.accessToken, navigate, onRefreshSessions, session])

  if (session === null) {
    return (
      <main className="app-shell">
        <section className="card">
          <h1>Session Control</h1>
          <p className="error-message">Session not found or inactive.</p>
          <button type="button" className="secondary" onClick={() => navigate('/sessions')}>
            Back to sessions
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="card session-control-card">
        <div className="card-header">
          <div>
            <h1>{session.name}</h1>
            <p className="subtitle">
              Session code: <code>{session.session_code}</code>
            </p>
            <p className="subtitle">WebSocket: {socketStatus}</p>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => navigate('/sessions')}>
              Back
            </button>
            <button type="button" className="secondary" onClick={() => onArchiveSession(session.id)}>
              End session
            </button>
          </div>
        </div>

        {wsMessage !== '' ? <p className="success-message">{wsMessage}</p> : null}

        <div className="control-layout">
          <section className="panel">
            <h2>Playback</h2>
            <p className="subtitle">
              State: {playbackState.isPlaying ? 'Playing' : 'Paused'} · Position:{' '}
              {playbackState.positionSeconds.toFixed(1)}s
            </p>
            <div className="playback-actions">
              <button type="button" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, isPlaying: true }))
                sendCommand('playback.play')
              }}>
                Play
              </button>
              <button type="button" className="secondary" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
                sendCommand('playback.pause')
              }}>
                Pause
              </button>
              <button type="button" className="secondary" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, positionSeconds: 0 }))
                sendCommand('playback.skip')
              }}>
                Skip
              </button>
              <button type="button" className="secondary" onClick={() => {
                const nextPosition = playbackState.positionSeconds + 10
                setPlaybackState((previous) => ({ ...previous, positionSeconds: nextPosition }))
                sendCommand('playback.seek', { position_seconds: nextPosition })
              }}>
                Seek +10s
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Queued Songs</h2>
              <button type="button" className="secondary" onClick={() => setWsMessage('Songbook is mocked for now.')}>
                Songbook
              </button>
            </div>
            <p className="subtitle">Download queue: {downloadsCount}</p>
            <div className="queue-list">
              {queueItems.length === 0 ? (
                <p className="empty-state">No queued songs.</p>
              ) : (
                queueItems.map((song) => (
                  <article className="queue-item" key={song.id}>
                    <strong>{song.title}</strong>
                    <p className="session-meta">
                      {song.artist} · {song.status}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
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

  const handleArchiveSession = useCallback(async (sessionId: string) => {
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
  }, [auth, loadSessions])

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
                onArchiveSession={(sessionId) => {
                  void handleArchiveSession(sessionId)
                }}
              />
            )
          }
        />
        <Route
          path="/sessions/:sessionCode"
          element={
            auth === null ? (
              <Navigate to="/login" replace />
            ) : (
              <SessionControlPage
                auth={auth}
                sessions={sessions}
                onRefreshSessions={() => {
                  void loadSessions(auth.accessToken)
                }}
                onArchiveSession={(sessionId) => {
                  void handleArchiveSession(sessionId)
                }}
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
