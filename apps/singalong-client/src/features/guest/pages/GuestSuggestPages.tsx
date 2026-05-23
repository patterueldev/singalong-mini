import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGuestSession } from '../hooks/useGuestSession'
import { SuggestSearchPage } from '../../suggest/pages/SuggestSearchPage'
import { SuggestUpdatePage } from '../../suggest/pages/SuggestUpdatePage'
import {
  clearSuggestDraft,
  readSuggestDraft,
  saveSuggestDraft,
} from '../../../shared/storage/suggestStorage'
import type { SuggestDraft } from '../../../shared/types/client'
import { isValidSessionCode } from '../../../shared/lib/validation'

function useGuestSuggestAccess() {
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  if (!hasGuestSession || guestAuth === null || !isValidSessionCode(sessionCode)) {
    return null
  }
  return { guestAuth, sessionCode }
}

export function GuestSuggestSearchRoute() {
  const access = useGuestSuggestAccess()
  const navigate = useNavigate()
  if (access === null) {
    return <Navigate to="/guest/join" replace />
  }

  return (
    <SuggestSearchPage
      nickname={access.guestAuth.nickname}
      authToken={access.guestAuth.accessToken}
      showChangeNicknameAction={false}
      searchPath="/guest/songbook/suggest/search"
      updatePath="/guest/songbook/suggest/update"
      backToSongbookPath="/guest/songbook"
      backToSongbookLabel="Back to Songbook"
      singlePageUrlIdentify
      onIdentifyDraft={saveSuggestDraft}
      onIdentify={(sourceUrl) => {
        navigate(`/guest/songbook/suggest/search?url=${encodeURIComponent(sourceUrl)}`)
      }}
      onCancel={clearSuggestDraft}
      onChangeNickname={clearSuggestDraft}
    />
  )
}

export function GuestSuggestUpdateRoute() {
  const access = useGuestSuggestAccess()
  const [draft, setDraft] = useState<SuggestDraft | null>(() => readSuggestDraft())

  useEffect(() => {
    if (draft === null) {
      clearSuggestDraft()
      return
    }
    saveSuggestDraft(draft)
  }, [draft])

  if (access === null) {
    return <Navigate to="/guest/join" replace />
  }
  if (draft === null) {
    return <Navigate to="/guest/songbook/suggest/search" replace />
  }

  return (
    <SuggestUpdatePage
      nickname={access.guestAuth.nickname}
      authToken={access.guestAuth.accessToken}
      draft={draft}
      onDraftChange={setDraft}
      showDownloadAndReserve
      reserveSessionCode={access.sessionCode}
      cancelPath="/guest/songbook"
      backPath="/guest/songbook/suggest/search"
      downloadPath="/guest/home"
      downloadAndReservePath="/guest/home"
      backButtonLabel="Back to Search"
      downloadButtonLabel="Download & Back to Home"
      downloadAndReserveButtonLabel="Download & Reserve"
      onDownload={() => {
        setDraft(null)
      }}
      onDownloadAndReserve={() => {
        setDraft(null)
      }}
      onCancel={() => {
        setDraft(null)
      }}
    />
  )
}
