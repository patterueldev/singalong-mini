import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Navigate,
} from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { LoginPage } from '../features/admin/pages/LoginPage'
import { SessionsPage } from '../features/admin/pages/SessionsPage'
import { SessionControlPage } from '../features/admin/pages/SessionControlPage'
import { GuestPage } from '../features/guest/pages/GuestPage'
import { PlayerPage } from '../features/player/pages/PlayerPage'
import { SuggestIdentifyPage } from '../features/suggest/pages/SuggestIdentifyPage'
import { SuggestLoginPage } from '../features/suggest/pages/SuggestLoginPage'
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

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (auth === null) {
      return
    }

    setSessionMessage('')
    setSessionErrorMessage('')
    setIsSavingSession(true)

    try {
      await createSession(newSessionName, auth.accessToken)

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
      const payload = await archiveSession(sessionId, auth.accessToken)

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
  const adminElement = <Navigate to={auth === null ? '/admin/login' : '/admin/sessions'} replace />
  const adminLoginElement =
    auth !== null ? (
      <Navigate to="/admin/sessions" replace />
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
  const guestElement = <GuestPage />
  const playerElement = <PlayerPage />
  const songbookElement = (
    <SongbookPage
      notice={songbookNotice}
      guestNickname={suggestAuth?.nickname ?? null}
      onChangeNickname={handleChangeSuggestNickname}
    />
  )
  const songDetailElement = <SongDetailPage />
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
      guestElement={guestElement}
      playerElement={playerElement}
      songbookElement={songbookElement}
      songDetailElement={songDetailElement}
      suggestLoginElement={suggestLoginElement}
      suggestSearchElement={suggestSearchElement}
      suggestIdentifyElement={suggestIdentifyElement}
      suggestUpdateElement={suggestUpdateElement}
      adminSessionsElement={adminSessionsElement}
      adminSessionControlElement={adminSessionControlElement}
    />
  )
}

export default AppShell
