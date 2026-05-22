import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FormEvent } from 'react'
import type { SessionRecord, UserProfile } from '../../../shared/types/client'

type SessionsPageProps = {
  user: UserProfile
  sessions: SessionRecord[]
  newSessionName: string
  newSessionVibes: string
  isLoadingSessions: boolean
  isSavingSession: boolean
  sessionMessage: string
  errorMessage: string
  onLogout: () => void
  onRefresh: () => void
  onSessionNameChange: (value: string) => void
  onSessionVibesChange: (value: string) => void
  onCreateSession: () => Promise<boolean>
  onArchiveSession: (sessionId: string) => Promise<boolean>
}

function toTimestamp(value: string) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

export function SessionsPage({
  user,
  sessions,
  newSessionName,
  newSessionVibes,
  isLoadingSessions,
  isSavingSession,
  sessionMessage,
  errorMessage,
  onLogout,
  onRefresh,
  onSessionNameChange,
  onSessionVibesChange,
  onCreateSession,
  onArchiveSession,
}: SessionsPageProps) {
  const navigate = useNavigate()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  const activeSessions = useMemo(
    () =>
      [...sessions]
        .filter((session) => session.archived_at === null)
        .sort((left, right) => toTimestamp(right.created_at) - toTimestamp(left.created_at)),
    [sessions],
  )
  const inactiveSessions = useMemo(
    () =>
      [...sessions]
        .filter((session) => session.archived_at !== null)
        .sort((left, right) => toTimestamp(right.archived_at ?? right.updated_at) - toTimestamp(left.archived_at ?? left.updated_at)),
    [sessions],
  )

  const latestActiveSession = activeSessions[0] ?? null
  const remainingActiveSessions = activeSessions.slice(1)

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const created = await onCreateSession()
    if (created) {
      setIsCreateModalOpen(false)
    }
  }

  const handleEndSession = async (session: SessionRecord) => {
    await onArchiveSession(session.id)
  }

  return (
    <main className="app-shell admin-dashboard-shell">
      <section className="card admin-dashboard-card">
        <div className="card-header admin-dashboard-header">
          <div>
            <h1>Admin Dashboard</h1>
            <p className="subtitle">
              Welcome, <strong>{user.username}</strong> ({user.role})
            </p>
          </div>
          <div className="row-actions admin-dashboard-header-actions">
            <button type="button" className="secondary" onClick={() => navigate('/admin/songbook')}>
              Songbook Management
            </button>
            <button type="button" onClick={() => setIsCreateModalOpen(true)}>
              Create session
            </button>
            <button
              type="button"
              className="icon-control-button"
              onClick={() => setIsHistoryModalOpen(true)}
              aria-label="Open session history"
              title="Session history"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                history
              </span>
            </button>
            <button type="button" className="secondary" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>

        <div className="metrics admin-dashboard-metrics">
          <div>
            <span className="metric-label">Active sessions</span>
            <strong>{activeSessions.length}</strong>
          </div>
          <div>
            <span className="metric-label">Inactive history</span>
            <strong>{inactiveSessions.length}</strong>
          </div>
          <div>
            <span className="metric-label">Total sessions</span>
            <strong>{sessions.length}</strong>
          </div>
        </div>

        {sessionMessage !== '' ? <p className="success-message">{sessionMessage}</p> : null}
        {errorMessage !== '' ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="list-header">
          <h2>Manage sessions</h2>
          <button type="button" className="secondary" onClick={onRefresh} disabled={isLoadingSessions}>
            {isLoadingSessions ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <section className="session-dashboard-stack top-gap">
          {latestActiveSession !== null ? (
            <article className="session-feature-card">
              <div className="session-title">
                <strong>{latestActiveSession.name}</strong>
                <span className="badge active">Latest active</span>
              </div>
              <p className="session-meta">
                Code: <code>{latestActiveSession.session_code}</code> · Created{' '}
                {new Date(latestActiveSession.created_at).toLocaleString()}
              </p>
              {latestActiveSession.vibes ? (
                <p className="session-meta">
                  Vibes: <strong>{latestActiveSession.vibes}</strong>
                </p>
              ) : null}
              <div className="row-actions top-gap">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigate(`/admin/sessions/${latestActiveSession.session_code}`)}
                >
                  Open controls
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void handleEndSession(latestActiveSession)}
                >
                  End Session
                </button>
              </div>
            </article>
          ) : (
            <p className="empty-state">No active sessions right now.</p>
          )}

          {remainingActiveSessions.length > 0 ? (
            <div className="session-list">
              {remainingActiveSessions.map((session) => (
                <article className="session-row" key={session.id}>
                  <div>
                    <div className="session-title">
                      <strong>{session.name}</strong>
                      <span className="badge active">Active</span>
                    </div>
                    <p className="session-meta">
                      Code: <code>{session.session_code}</code> · Created{' '}
                      {new Date(session.created_at).toLocaleString()}
                    </p>
                    {session.vibes ? <p className="session-meta">Vibes: {session.vibes}</p> : null}
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => navigate(`/admin/sessions/${session.session_code}`)}
                    >
                      Open controls
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void handleEndSession(session)}
                    >
                      End Session
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>

      {isCreateModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsCreateModalOpen(false)}>
          <section
            className="modal-card dashboard-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Create session"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Create session</h2>
                <p className="subtitle">Set a title and vibes before starting the next room.</p>
              </div>
              <button type="button" className="secondary" onClick={() => setIsCreateModalOpen(false)}>
                Close
              </button>
            </div>

            <form className="form top-gap dashboard-modal-form" onSubmit={handleCreateSubmit}>
              <label>
                Session title
                <input
                  value={newSessionName}
                  onChange={(event) => onSessionNameChange(event.target.value)}
                  placeholder="Friday Karaoke Night"
                  required
                />
              </label>
              <label>
                Vibes
                <input
                  value={newSessionVibes}
                  onChange={(event) => onSessionVibesChange(event.target.value)}
                  placeholder="anime, high-energy, nostalgic"
                />
              </label>
              <div className="row-actions">
                <button type="submit" disabled={isSavingSession}>
                  {isSavingSession ? 'Creating…' : 'Create session'}
                </button>
                <button type="button" className="secondary" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isHistoryModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsHistoryModalOpen(false)}>
          <section
            className="modal-card dashboard-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Session history"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Session history</h2>
                <p className="subtitle">Inactive sessions are kept here for reference.</p>
              </div>
              <button type="button" className="secondary" onClick={() => setIsHistoryModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="session-history-list top-gap">
              {inactiveSessions.length === 0 ? (
                <p className="empty-state">No inactive sessions yet.</p>
              ) : (
                inactiveSessions.map((session) => (
                  <article className="session-row" key={session.id}>
                    <div>
                      <div className="session-title">
                        <strong>{session.name}</strong>
                        <span className="badge inactive">Inactive</span>
                      </div>
                      <p className="session-meta">
                        Code: <code>{session.session_code}</code> · Created{' '}
                        {new Date(session.created_at).toLocaleString()}
                      </p>
                      <p className="session-meta">
                        Ended {session.archived_at ? new Date(session.archived_at).toLocaleString() : '—'}
                      </p>
                      {session.vibes ? <p className="session-meta">Vibes: {session.vibes}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => navigate(`/admin/sessions/${session.session_code}`)}
                    >
                      Open controls
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
