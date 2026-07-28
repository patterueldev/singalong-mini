import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { fetchSessionParticipants } from '../services/adminService'
import { SuggestSearchPage } from '../../suggest/pages/SuggestSearchPage'
import { SuggestUpdatePage } from '../../suggest/pages/SuggestUpdatePage'
import type { StoredAuth, SuggestDraft } from '../../../shared/types/client'
import { isValidSessionCode } from '../../../shared/lib/validation'

type AdminSessionSuggestSearchRouteProps = {
  auth: StoredAuth
  onIdentifyDraft: (draft: SuggestDraft) => void
  onCancel: () => void
  isModal?: boolean
}

export function AdminSessionSuggestSearchRoute({
  auth,
  onIdentifyDraft,
  onCancel,
  isModal = false,
}: AdminSessionSuggestSearchRouteProps) {
  const navigate = useNavigate()
  const { sessionCode = '' } = useParams()
  if (!isValidSessionCode(sessionCode)) {
    return <Navigate to="/admin/dashboard" replace />
  }

  const searchPath = `/admin/sessions/${sessionCode}/songbook/suggest/search`
  // Use dummy path when in modal mode to prevent navigation
  const updatePath = isModal ? '#' : `/admin/sessions/${sessionCode}/songbook/suggest/update`
  const backPath = `/admin/sessions/${sessionCode}`

  return (
    <SuggestSearchPage
      nickname={auth.user.username}
      authToken={auth.accessToken}
      onCancel={onCancel}
      onChangeNickname={onCancel}
      onIdentify={(sourceUrl) => {
        navigate(`${searchPath}?url=${encodeURIComponent(sourceUrl)}`)
      }}
      searchPath={searchPath}
      updatePath={updatePath}
      backToSongbookPath={backPath}
      backToSongbookLabel="Back to Session"
      showChangeNicknameAction={false}
      singlePageUrlIdentify
      onIdentifyDraft={onIdentifyDraft}
      title="Suggest a Song"
      hideSearchLabel
      searchInputPlaceholder="Enter song keyword or URL"
      showCloseAction={isModal}
      closeActionLabel="Close"
      showSignedIn={false}
    />
  )
}

type AdminSessionSuggestUpdateRouteProps = {
  auth: StoredAuth
  draft: SuggestDraft | null
  onDraftChange: (draft: SuggestDraft | null) => void
  onCancel: () => void
}

export function AdminSessionSuggestUpdateRoute({
  auth,
  draft,
  onDraftChange,
  onCancel,
}: AdminSessionSuggestUpdateRouteProps) {
  const { sessionCode = '' } = useParams()
  const [participantNicknames, setParticipantNicknames] = useState<string[]>([])

  useEffect(() => {
    if (!isValidSessionCode(sessionCode)) {
      setParticipantNicknames([])
      return
    }
    let cancelled = false
    void fetchSessionParticipants(sessionCode, auth.accessToken)
      .then((participants) => {
        if (cancelled) return
        setParticipantNicknames(
          participants.map((participant) => participant.username).filter((name) => name.trim() !== ''),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setParticipantNicknames([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth.accessToken, sessionCode])

  const reserveTargetOptions = useMemo(
    () => Array.from(new Set([auth.user.username, ...participantNicknames])),
    [auth.user.username, participantNicknames],
  )

  if (!isValidSessionCode(sessionCode)) {
    return <Navigate to="/admin/dashboard" replace />
  }
  if (draft === null) {
    return <Navigate to={`/admin/sessions/${sessionCode}/songbook/suggest/search`} replace />
  }

  const sessionHomePath = `/admin/sessions/${sessionCode}`

  return (
    <SuggestUpdatePage
      nickname={auth.user.username}
      authToken={auth.accessToken}
      draft={draft}
      onDraftChange={(nextDraft) => onDraftChange(nextDraft)}
      showDownloadAndReserve
      reserveSessionCode={sessionCode}
      reserveTargetOptions={reserveTargetOptions}
      reserveTargetLabel="Reserve for nickname"
      defaultReserveTarget={auth.user.username}
      allowCustomReserveTarget
      cancelPath={sessionHomePath}
      downloadPath={sessionHomePath}
      downloadAndReservePath={sessionHomePath}
      downloadButtonLabel="Download & Back to Home"
      downloadAndReserveButtonLabel="Download & Reserve"
      onDownload={() => {
        onDraftChange(null)
      }}
      onDownloadAndReserve={() => {
        onDraftChange(null)
      }}
      onCancel={onCancel}
    />
  )
}
