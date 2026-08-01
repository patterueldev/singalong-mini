import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Navigate,
  useNavigate,
} from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { LoginPage } from '../features/admin/pages/LoginPage'
import { AdminSongbookPage } from '../features/admin/pages/AdminSongbookPage'
import { AdminDuplicateAuditPage } from '../features/admin/pages/AdminDuplicateAuditPage'
import { SessionsPage } from '../features/admin/pages/SessionsPage'
import { SessionControlPage } from '../features/admin/pages/SessionControlPage'
import { GuestPage } from '../features/guest/pages/GuestPage'
import { GuestHomePage } from '../features/guest/pages/GuestHomePage'
import { GuestDownloadsPage } from '../features/guest/pages/GuestDownloadsPage'
import { GuestSongbookPage } from '../features/guest/pages/GuestSongbookPage'
import { GuestSuggestDraftPage } from '../features/guest/pages/GuestSuggestDraftPage'
import { PlayerPage } from '../features/player/pages/PlayerPage'
import { SuggestLoginPage } from '../features/suggest/pages/SuggestLoginPage'
import { SuggestSearchRoute } from '../features/suggest/pages/SuggestSearchRoute'
import { SuggestUpdatePage } from '../features/suggest/pages/SuggestUpdatePage'
import { SongbookPage } from '../features/songbook/pages/SongbookPage'
import { SongDetailPage } from '../features/songbook/pages/SongDetailPage'
import { SongbookSuggestDraftPage } from '../features/songbook/pages/SongbookSuggestDraftPage'
import {
  AdminSessionSuggestSearchRoute,
  AdminSessionSuggestUpdateRoute,
} from '../features/admin/pages/AdminSessionSuggestPages'
import { LoadingView } from '../features/shared/pages/LoadingView'
import {
  archiveSession,
  createSession,
  fetchCurrentUser,
  listSessions,
  updateSessionMetadata,
} from '../features/admin/services/adminService'
import { guestLoginWithNickname } from '../features/guest/services/guestService'
import { logoutUser } from '../features/shared/services/authService'
import { apiJson, ApiError, setOnAuthFailure } from '../shared/api/httpClient'
import { clearStoredAuth, readStoredAuth, saveStoredAuth } from '../shared/storage/authStorage'
import {
  clearSuggestAuth,
  clearSuggestDraft,
  readSuggestDraft,
  saveSuggestDraft,
} from '../shared/storage/suggestStorage'
import {
  clearGuestAuth,
  readGuestAuth,
  saveGuestAuth,
} from '../shared/storage/guestStorage'
import type {
  GuestAuth,
  LoginResponse,
  SessionRecord,
  StoredAuth,
  SuggestDraft,
} from '../shared/types/client'
import '../App.css'

function AppShellContent() {
  const navigate = useNavigate()
  const [auth, setAuth] = useState<StoredAuth | null>(null)
  const [isHydratingAuth, setIsHydratingAuth] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginErrorMessage, setLoginErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionVibes, setNewSessionVibes] = useState('')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isSavingSession, setIsSavingSession] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')
  const [publicGuestAuth, setPublicGuestAuth] = useState<GuestAuth | null>(null)
  const [suggestDraft, setSuggestDraft] = useState<SuggestDraft | null>(() => readSuggestDraft())
  const [songbookNotice, setSongbookNotice] = useState('')

  const loadSessions = useCallback(async (token: string) => {
    setIsLoadingSessions(true)
    setSessionErrorMessage('')
    try {
      const payload = await listSessions(token)
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
    const storedGuestAuth = readGuestAuth()
    if (storedGuestAuth === null) {
      return
    }

    let cancelled = false

    const validate = async () => {
      try {
        await fetchCurrentUser(storedGuestAuth.accessToken)
        if (cancelled) return
        setPublicGuestAuth(storedGuestAuth)
      } catch {
        clearGuestAuth()
        clearSuggestAuth()
        if (!cancelled) {
          setPublicGuestAuth(null)
        }
      }
    }

    void validate()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (suggestDraft === null) {
      clearSuggestDraft()
      return
    }

    saveSuggestDraft(suggestDraft)
  }, [suggestDraft])

  useEffect(() => {
    const storedAuth = readStoredAuth()
    if (storedAuth === null) {
      setIsHydratingAuth(false)
      return
    }

    let cancelled = false

    const hydrate = async () => {
      try {
        const user = await fetchCurrentUser(storedAuth.accessToken)
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
    setOnAuthFailure(() => {
      clearStoredAuth()
      clearGuestAuth()
      clearSuggestAuth()
      setAuth(null)
      setPublicGuestAuth(null)
      setSessions([])
    })

    return () => {
      setOnAuthFailure(null)
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
      await logoutUser(auth.user.username, auth.accessToken)
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

  const handleCreateSession = useCallback(async (): Promise<boolean> => {
    if (auth === null) {
      return false
    }

    const sessionName = newSessionName.trim()
    const sessionVibes = newSessionVibes.trim()
    if (sessionName === '') {
      setSessionErrorMessage('Session title is required.')
      return false
    }

    setSessionMessage('')
    setSessionErrorMessage('')
    setIsSavingSession(true)

    try {
      const createdSession = await createSession(sessionName, auth.accessToken)

      if (sessionVibes !== '') {
        try {
          await updateSessionMetadata(createdSession.id, auth.accessToken, { vibes: sessionVibes })
        } catch {
          setNewSessionName('')
          setNewSessionVibes('')
          setSessionMessage('Session created. Vibes could not be saved.')
          await loadSessions(auth.accessToken)
          return true
        }
      }

      setNewSessionName('')
      setNewSessionVibes('')
      setSessionMessage('Session created.')
      await loadSessions(auth.accessToken)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        return false
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error creating session'
      setSessionErrorMessage(message)
      return false
    } finally {
      setIsSavingSession(false)
    }
  }, [auth, loadSessions, newSessionName, newSessionVibes])

  const handleArchiveSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (auth === null) {
        return false
      }

      setSessionMessage('')
      setSessionErrorMessage('')

      const targetSession = sessions.find((session) => session.id === sessionId)
      if (targetSession !== undefined) {
        const shouldEnd = window.confirm(`End session "${targetSession.name}"?`)
        if (!shouldEnd) {
          return false
        }
      }

      try {
        const payload = await archiveSession(sessionId, auth.accessToken)

        setSessionMessage(`${payload.session.session_code} archived.`)
        await loadSessions(auth.accessToken)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearStoredAuth()
          setAuth(null)
          return false
        }

        const message =
          error instanceof Error ? error.message : 'Unexpected error archiving session'
        setSessionErrorMessage(message)
        return false
      }
    },
    [auth, loadSessions, sessions],
  )

  const hasPublicGuestAuth = publicGuestAuth !== null

  const handlePublicGuestLogin = useCallback(async (nickname: string) => {
    const cleaned = nickname.trim()
    const guestAuthPayload = await guestLoginWithNickname(cleaned)
    setPublicGuestAuth(guestAuthPayload)
    saveGuestAuth(guestAuthPayload)
  }, [])

  const handleCancelSuggestion = useCallback(() => {
    setSuggestDraft(null)
  }, [])

  if (isHydratingAuth) {
    return <LoadingView />
  }
  const adminElement = <Navigate to={auth === null ? '/admin/login' : '/admin/dashboard'} replace />
  const adminLoginElement =
    auth !== null ? (
      <Navigate to="/admin/dashboard" replace />
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
  const guestJoinElement = <GuestPage />
  const guestHomeElement = <GuestHomePage />
  const guestDownloadsElement = <GuestDownloadsPage />
  const guestSongbookElement = <GuestSongbookPage />
  const guestSuggestDraftElement = <GuestSuggestDraftPage />
  const playerElement = <PlayerPage />
  const songbookLoginElement = hasPublicGuestAuth ? (
    <Navigate to="/songbook" replace />
  ) : (
    <SuggestLoginPage
      initialNickname=""
      nextPath="/songbook"
      onLogin={handlePublicGuestLogin}
    />
  )
  const songbookElement =
    publicGuestAuth === null ? (
      <Navigate to="/songbook/login" replace />
    ) : (
      <SongbookPage
        notice={songbookNotice}
        guestNickname={publicGuestAuth.nickname}
        authToken={publicGuestAuth.accessToken}
      />
    )
  const songDetailElement = <SongDetailPage />
  const songbookDraftElement =
    publicGuestAuth === null ? (
      <Navigate to="/songbook/login" replace />
    ) : (
      <SongbookSuggestDraftPage
        authToken={publicGuestAuth.accessToken}
        onDownloaded={(title) => setSongbookNotice(`${title} is now downloading!`)}
      />
    )
  const adminSongbookSuggestSearchElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <>
        <div className="admin-songbook-suggest-underlay" aria-hidden="true">
          <AdminSongbookPage auth={auth} />
        </div>
        <div
          className="modal-backdrop admin-songbook-suggest-backdrop"
          role="presentation"
          onClick={() => {
            handleCancelSuggestion()
            navigate('/admin/songbook')
          }}
        >
          <div role="presentation" onClick={(event) => event.stopPropagation()}>
            <SuggestSearchRoute
              nickname={auth.user.username}
              authToken={auth.accessToken}
              onCancel={handleCancelSuggestion}
              onIdentifyDraft={setSuggestDraft}
              searchPath="/admin/songbook/suggest/search"
              updatePath="/admin/songbook/suggest/update"
              backToSongbookPath="/admin/songbook"
              showChangeNicknameAction={false}
              showCloseAction
              closeActionLabel="Close"
              title="Suggest a Song"
              hideSearchLabel
              searchInputPlaceholder="Enter song keyword or URL"
              showSignedIn={false}
            />
          </div>
        </div>
      </>
    )
  const adminSongbookSuggestUpdateElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : suggestDraft === null ? (
      <Navigate to="/admin/songbook/suggest/search" replace />
    ) : (
      <>
        <div className="admin-songbook-suggest-underlay" aria-hidden="true">
          <AdminSongbookPage auth={auth} />
        </div>
        <div
          className="modal-backdrop admin-songbook-suggest-backdrop"
          role="presentation"
          onClick={() => {
            handleCancelSuggestion()
            navigate('/admin/songbook')
          }}
        >
          <div role="presentation" onClick={(event) => event.stopPropagation()}>
            <SuggestUpdatePage
              nickname={auth.user.username}
              authToken={auth.accessToken}
              draft={suggestDraft}
              onDraftChange={setSuggestDraft}
              onDownload={(title) => {
                setSongbookNotice(`${title} is now downloading!`)
                setSuggestDraft(null)
              }}
              onCancel={handleCancelSuggestion}
              cancelPath="/admin/songbook"
              downloadPath="/admin/songbook/suggest/search"
              downloadAndReservePath="/admin/songbook"
              showDownloadAndReserve
              downloadButtonLabel="Download & Add Another"
              downloadAndReserveButtonLabel="Download & Back to Songbook"
              onDownloadAndReserve={() => {
                setSuggestDraft(null)
              }}
            />
          </div>
        </div>
      </>
    )
  const adminSessionsElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <SessionsPage
        user={auth.user}
        sessions={sessions}
        newSessionName={newSessionName}
        newSessionVibes={newSessionVibes}
        isLoadingSessions={isLoadingSessions}
        isSavingSession={isSavingSession}
        sessionMessage={sessionMessage}
        errorMessage={sessionErrorMessage}
        onLogout={handleLogout}
        onRefresh={() => {
          void loadSessions(auth.accessToken)
        }}
        onSessionNameChange={setNewSessionName}
        onSessionVibesChange={setNewSessionVibes}
        onCreateSession={handleCreateSession}
        onArchiveSession={handleArchiveSession}
      />
    )
  const adminSongbookElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <AdminSongbookPage auth={auth} />
    )
  const adminDuplicateAuditElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <AdminDuplicateAuditPage auth={auth} />
    )
  const adminSessionControlElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
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
  const adminSessionSuggestSearchElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <AdminSessionSuggestSearchRoute
          auth={auth}
          onIdentifyDraft={setSuggestDraft}
          onCancel={handleCancelSuggestion}
        />
      </div>
    )
  const adminSessionSuggestUpdateElement =
    auth === null ? (
      <Navigate to="/admin/login" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <AdminSessionSuggestUpdateRoute
          auth={auth}
          draft={suggestDraft}
          onDraftChange={setSuggestDraft}
          onCancel={handleCancelSuggestion}
        />
      </div>
    )

  return (
    <AppRoutes
      adminElement={adminElement}
      adminLoginElement={adminLoginElement}
      guestJoinElement={guestJoinElement}
      guestHomeElement={guestHomeElement}
      guestDownloadsElement={guestDownloadsElement}
      guestSongbookElement={guestSongbookElement}
      guestSuggestDraftElement={guestSuggestDraftElement}
      playerElement={playerElement}
      songbookLoginElement={songbookLoginElement}
      songbookElement={songbookElement}
      songDetailElement={songDetailElement}
      songbookDraftElement={songbookDraftElement}
      adminSessionsElement={adminSessionsElement}
      adminSongbookElement={adminSongbookElement}
      adminDuplicateAuditElement={adminDuplicateAuditElement}
      adminSongbookSuggestSearchElement={adminSongbookSuggestSearchElement}
      adminSongbookSuggestUpdateElement={adminSongbookSuggestUpdateElement}
      adminSessionControlElement={adminSessionControlElement}
      adminSessionSuggestSearchElement={adminSessionSuggestSearchElement}
      adminSessionSuggestUpdateElement={adminSessionSuggestUpdateElement}
    />
  )
}

export default AppShellContent
