import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Navigate,
  useNavigate,
} from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { LoginPage } from '../features/admin/pages/LoginPage'
import { AdminSongbookPage } from '../features/admin/pages/AdminSongbookPage'
import { SessionsPage } from '../features/admin/pages/SessionsPage'
import { SessionControlPage } from '../features/admin/pages/SessionControlPage'
import { GuestPage } from '../features/guest/pages/GuestPage'
import { GuestHomePage } from '../features/guest/pages/GuestHomePage'
import { GuestDownloadsPage } from '../features/guest/pages/GuestDownloadsPage'
import { GuestSongbookPage } from '../features/guest/pages/GuestSongbookPage'
import {
  GuestSuggestIdentifyRoute,
  GuestSuggestSearchRoute,
  GuestSuggestUpdateRoute,
} from '../features/guest/pages/GuestSuggestPages'
import { PlayerPage } from '../features/player/pages/PlayerPage'
import { SuggestIdentifyPage } from '../features/suggest/pages/SuggestIdentifyPage'
import { SuggestLoginPage } from '../features/suggest/pages/SuggestLoginPage'
import { SuggestSearchPage } from '../features/suggest/pages/SuggestSearchPage'
import { SuggestSearchRoute } from '../features/suggest/pages/SuggestSearchRoute'
import { SuggestUpdatePage } from '../features/suggest/pages/SuggestUpdatePage'
import { SongbookPage } from '../features/songbook/pages/SongbookPage'
import { SongDetailPage } from '../features/songbook/pages/SongDetailPage'
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
import { apiJson, ApiError } from '../shared/api/httpClient'
import { clearStoredAuth, readStoredAuth, saveStoredAuth } from '../shared/storage/authStorage'
import {
  clearSuggestAuth,
  clearSuggestDraft,
  clearSuggestNickname,
  readSuggestAuth,
  readSuggestDraft,
  readSuggestNickname,
  saveSuggestAuth,
  saveSuggestDraft,
  saveSuggestNickname,
} from '../shared/storage/suggestStorage'
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
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('password')
  const [loginErrorMessage, setLoginErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionVibes, setNewSessionVibes] = useState('')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isSavingSession, setIsSavingSession] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')
  const [suggestAuth, setSuggestAuth] = useState<GuestAuth | null>(null)
  const [suggestNickname, setSuggestNickname] = useState('')
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
    const storedSuggestAuth = readSuggestAuth()
    if (storedSuggestAuth !== null) {
      setSuggestAuth(storedSuggestAuth)
      setSuggestNickname(storedSuggestAuth.nickname)
      return
    }

    setSuggestNickname(readSuggestNickname())
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

  const hasSuggestAuth = suggestAuth !== null

  const handleSuggestLogin = useCallback(async (nickname: string) => {
    const cleaned = nickname.trim()
    const guestAuth = await guestLoginWithNickname(cleaned)
    setSuggestAuth(guestAuth)
    setSuggestNickname(guestAuth.nickname)
    saveSuggestNickname(guestAuth.nickname)
    saveSuggestAuth(guestAuth)
  }, [])

  const handleSelectSuggestDraft = useCallback((draft: SuggestDraft) => {
    setSuggestDraft(draft)
  }, [])

  const handleDownloadSuggestion = useCallback((title: string) => {
    setSongbookNotice(`${title} is now downloading!`)
    setSuggestDraft(null)
  }, [])

  const handleCancelSuggestion = useCallback(() => {
    setSuggestDraft(null)
  }, [])

  const handleChangeSuggestNickname = useCallback(() => {
    clearSuggestAuth()
    clearSuggestNickname()
    setSuggestAuth(null)
    setSuggestNickname('')
    setSuggestDraft(null)
    setSongbookNotice('Nickname cleared. Sign in again to continue suggesting songs.')
  }, [])

  if (isHydratingAuth) {
    return <LoadingView />
  }

  const rootElement = <Navigate to="/guest" replace />
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
  const guestSuggestSearchElement = <GuestSuggestSearchRoute />
  const guestSuggestIdentifyElement = <GuestSuggestIdentifyRoute />
  const guestSuggestUpdateElement = <GuestSuggestUpdateRoute />
  const playerElement = <PlayerPage />
  const songbookElement = <SongbookPage notice={songbookNotice} guestNickname={suggestAuth?.nickname ?? null} onChangeNickname={handleChangeSuggestNickname} />
  const songDetailElement = <SongDetailPage />
  const adminSongbookSuggestLoginElement =
    suggestAuth !== null ? (
      <Navigate to="/admin/songbook/suggest/search" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <SuggestLoginPage
          initialNickname={suggestNickname}
          nextPath="/admin/songbook/suggest/search"
          onLogin={handleSuggestLogin}
        />
      </div>
    )
  const adminSongbookSuggestSearchElement =
    suggestAuth === null ? (
      <Navigate to="/admin/songbook/suggest/login" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <SuggestSearchPage
          nickname={suggestAuth.nickname}
          authToken={suggestAuth.accessToken}
          onCancel={handleCancelSuggestion}
          onChangeNickname={handleChangeSuggestNickname}
          onIdentify={() => {
            navigate('/admin/songbook/suggest/identify')
          }}
          searchPath="/admin/songbook/suggest/search"
          identifyPath="/admin/songbook/suggest/identify"
          updatePath="/admin/songbook/suggest/update"
          backToSongbookPath="/admin/songbook"
          backToSongbookLabel="Back to Songbook Management"
          showChangeNicknameAction
          singlePageUrlIdentify
          onIdentifyDraft={setSuggestDraft}
        />
      </div>
    )
  const adminSongbookSuggestIdentifyElement =
    suggestAuth === null ? (
      <Navigate to="/admin/songbook/suggest/login" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <SuggestIdentifyPage
          nickname={suggestAuth.nickname}
          authToken={suggestAuth.accessToken}
          onIdentify={setSuggestDraft}
          onCancel={handleCancelSuggestion}
          onChangeNickname={handleChangeSuggestNickname}
          updatePath="/admin/songbook/suggest/update"
          searchPath="/admin/songbook/suggest/search"
          backToSongbookPath="/admin/songbook"
          backToSongbookLabel="Back to Songbook Management"
          showChangeNicknameAction
        />
      </div>
    )
  const adminSongbookSuggestUpdateElement =
    suggestAuth === null ? (
      <Navigate to="/admin/songbook/suggest/login" replace />
    ) : suggestDraft === null ? (
      <Navigate to="/admin/songbook/suggest/search" replace />
    ) : (
      <div className="modal-backdrop admin-songbook-suggest-backdrop" role="presentation">
        <SuggestUpdatePage
          nickname={suggestAuth.nickname}
          authToken={suggestAuth.accessToken}
          draft={suggestDraft}
          onDraftChange={setSuggestDraft}
          onDownload={(title) => {
            setSongbookNotice(`${title} is now downloading!`)
            setSuggestDraft(null)
          }}
          onCancel={handleCancelSuggestion}
          cancelPath="/admin/songbook"
          backPath="/admin/songbook/suggest/search"
          downloadPath="/admin/songbook"
          downloadAndReservePath="/admin/songbook"
          backButtonLabel="Back to Search"
        />
      </div>
    )
  const suggestLoginElement = hasSuggestAuth ? (
    <Navigate to="/songbook/suggest/search" replace />
  ) : (
    <SuggestLoginPage
      initialNickname={suggestNickname}
      onLogin={handleSuggestLogin}
    />
  )
  const suggestSearchElement = !hasSuggestAuth ? (
    <Navigate to="/songbook/suggest/login" replace />
  ) : (
    <SuggestSearchRoute
      nickname={suggestAuth.nickname}
      authToken={suggestAuth.accessToken}
      onCancel={handleCancelSuggestion}
      onChangeNickname={handleChangeSuggestNickname}
    />
  )
  const suggestIdentifyElement = !hasSuggestAuth ? (
    <Navigate to="/songbook/suggest/login" replace />
  ) : (
    <SuggestIdentifyPage
      nickname={suggestAuth.nickname}
      authToken={suggestAuth.accessToken}
      onIdentify={handleSelectSuggestDraft}
      onCancel={handleCancelSuggestion}
      onChangeNickname={handleChangeSuggestNickname}
    />
  )
  const suggestUpdateElement = !hasSuggestAuth ? (
    <Navigate to="/songbook/suggest/login" replace />
  ) : suggestDraft === null ? (
    <Navigate to="/songbook/suggest/search" replace />
  ) : (
    <SuggestUpdatePage
      nickname={suggestAuth.nickname}
      authToken={suggestAuth.accessToken}
      draft={suggestDraft}
      onDraftChange={setSuggestDraft}
      onDownload={handleDownloadSuggestion}
      onCancel={handleCancelSuggestion}
    />
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

  return (
    <AppRoutes
      rootElement={rootElement}
      adminElement={adminElement}
      adminLoginElement={adminLoginElement}
      guestJoinElement={guestJoinElement}
      guestHomeElement={guestHomeElement}
      guestDownloadsElement={guestDownloadsElement}
      guestSongbookElement={guestSongbookElement}
      guestSuggestSearchElement={guestSuggestSearchElement}
      guestSuggestIdentifyElement={guestSuggestIdentifyElement}
      guestSuggestUpdateElement={guestSuggestUpdateElement}
      playerElement={playerElement}
      songbookElement={songbookElement}
      songDetailElement={songDetailElement}
      suggestLoginElement={suggestLoginElement}
      suggestSearchElement={suggestSearchElement}
      suggestIdentifyElement={suggestIdentifyElement}
      suggestUpdateElement={suggestUpdateElement}
      adminSessionsElement={adminSessionsElement}
      adminSongbookElement={adminSongbookElement}
      adminSongbookSuggestLoginElement={adminSongbookSuggestLoginElement}
      adminSongbookSuggestSearchElement={adminSongbookSuggestSearchElement}
      adminSongbookSuggestIdentifyElement={adminSongbookSuggestIdentifyElement}
      adminSongbookSuggestUpdateElement={adminSongbookSuggestUpdateElement}
      adminSessionControlElement={adminSessionControlElement}
    />
  )
}

export default AppShellContent
