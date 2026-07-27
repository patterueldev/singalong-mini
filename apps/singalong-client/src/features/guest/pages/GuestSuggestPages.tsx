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

type GuestSuggestSearchRouteProps = {
  onIdentifyDraft?: (draft: SuggestDraft) => void
  onCancel?: () => void
  initialKeyword?: string
}

export function GuestSuggestSearchRoute({
  onIdentifyDraft,
  onCancel,
  initialKeyword = '',
}: GuestSuggestSearchRouteProps = {}) {
  const access = useGuestSuggestAccess()
  const navigate = useNavigate()
  if (access === null) {
    return <Navigate to="/guest/join" replace />
  }

  const handleIdentify = (sourceUrl: string) => {
    // The SuggestSearchPage with singlePageUrlIdentify handles the identify internally
    // and calls onIdentifyDraft when ready. No additional navigation needed in modal mode.
    // In route mode, navigate to update the URL params for the page identify logic.
    if (!onIdentifyDraft) {
      navigate(`/guest/songbook/suggest/search?url=${encodeURIComponent(sourceUrl)}`)
    }
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
      onIdentifyDraft={onIdentifyDraft || saveSuggestDraft}
      onIdentify={handleIdentify}
      onCancel={onCancel || clearSuggestDraft}
      onChangeNickname={onCancel || clearSuggestDraft}
      title="Suggest a Song"
      hideSearchLabel
      searchInputPlaceholder="Enter song keyword or URL"
      showCloseAction={!!onIdentifyDraft}
      closeActionLabel="Close"
      showSignedIn={false}
      initialQuery={initialKeyword}
    />
  )
}

type GuestSuggestUpdateRouteProps = {
  draft?: SuggestDraft | null
  onDraftChange?: (draft: SuggestDraft | null) => void
  onCancel?: () => void
}

export function GuestSuggestUpdateRoute({
  draft: propDraft,
  onDraftChange: propOnDraftChange,
  onCancel: propOnCancel,
}: GuestSuggestUpdateRouteProps = {}) {
  const access = useGuestSuggestAccess()
  const [draft, setDraft] = useState<SuggestDraft | null>(() => propDraft !== undefined ? propDraft : readSuggestDraft())

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

  const handleDraftChange = (newDraft: SuggestDraft | null) => {
    if (propOnDraftChange) {
      propOnDraftChange(newDraft)
    } else {
      setDraft(newDraft)
    }
  }

  const handleCancel = () => {
    if (propOnCancel) {
      propOnCancel()
    } else {
      setDraft(null)
    }
  }

  return (
    <SuggestUpdatePage
      nickname={access.guestAuth.nickname}
      authToken={access.guestAuth.accessToken}
      draft={draft}
      onDraftChange={handleDraftChange}
      showDownloadAndReserve
      reserveSessionCode={access.sessionCode}
      defaultReserveTarget={access.guestAuth.nickname}
      cancelPath="/guest/songbook"
      downloadPath="/guest/home"
      downloadAndReservePath="/guest/home"
      downloadButtonLabel="Download & Back to Home"
      downloadAndReserveButtonLabel="Download & Reserve"
      onDownload={() => {
        handleDraftChange(null)
      }}
      onDownloadAndReserve={() => {
        handleDraftChange(null)
      }}
      onCancel={handleCancel}
    />
  )
}
