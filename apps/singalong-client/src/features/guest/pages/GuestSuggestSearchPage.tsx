import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useGuestSession } from '../hooks/useGuestSession'
import { useSuggestSearchFlow } from '../../suggest/hooks/useSuggestSearchFlow'
import { IdentifyOverrideModal } from '../../suggest/components/IdentifyOverrideModal'
import { SearchResultModal } from '../../suggest/components/SearchResultModal'
import { SearchResultsList } from '../../suggest/components/SearchResultsList'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import { clearSuggestDraft, saveSuggestDraft } from '../../../shared/storage/suggestStorage'
import type { SuggestDraft, SuggestResult } from '../../../shared/types/client'
import { isValidSessionCode } from '../../../shared/lib/validation'

const SEARCH_PATH = '/songs/suggest/search'
const UPDATE_PATH = '/songs/suggest/update'
const BACK_TO_SONGBOOK_PATH = '/songs'

function useGuestSuggestAccess() {
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  if (!hasGuestSession || guestAuth === null || !isValidSessionCode(sessionCode)) {
    return null
  }
  return { guestAuth, sessionCode }
}

type GuestSuggestSearchPageProps = {
  onIdentifyDraft?: (draft: SuggestDraft) => void
  onCancel?: () => void
  initialKeyword?: string
}

export function GuestSuggestSearchPage(props: GuestSuggestSearchPageProps = {}) {
  const access = useGuestSuggestAccess()
  if (access === null) {
    return <Navigate to="/join" replace />
  }
  return <GuestSuggestSearchPageContent authToken={access.guestAuth.accessToken} {...props} />
}

type GuestSuggestSearchPageContentProps = GuestSuggestSearchPageProps & {
  authToken: string
}

function GuestSuggestSearchPageContent({
  authToken,
  onIdentifyDraft,
  onCancel,
  initialKeyword = '',
}: GuestSuggestSearchPageContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const lastAutoIdentifyUrlRef = useRef('')
  const [selectedResult, setSelectedResult] = useState<SuggestResult | null>(null)

  const isModal = onIdentifyDraft !== undefined
  const resolvedOnIdentifyDraft = onIdentifyDraft ?? saveSuggestDraft
  const resolvedOnCancel = onCancel ?? clearSuggestDraft

  const {
    query,
    setQuery,
    effectiveQuery,
    queryInfo,
    results,
    errorMessage,
    isSearching,
    isIdentifyingUrl,
    isYouTubeUrlQuery,
    pendingIdentifyResult,
    clearPendingIdentifyResult,
    executeSearch,
    requestIdentify,
    confirmPendingIdentify,
    handleIdentifyUrl,
    identifySourceUrl,
  } = useSuggestSearchFlow({
    authToken,
    initialQuery: initialKeyword,
    onIdentified: (draft) => {
      resolvedOnIdentifyDraft(draft)
      navigate(UPDATE_PATH, { replace: true })
    },
  })

  const shouldShowUrlPrompt = query.trim() !== '' && isYouTubeUrlQuery

  useEffect(() => {
    const keyword = new URLSearchParams(location.search).get('keyword')?.trim() ?? ''
    if (keyword === '') {
      return
    }
    setQuery(keyword)
  }, [location.search, setQuery])

  useEffect(() => {
    const sourceUrl = new URLSearchParams(location.search).get('url')?.trim() ?? ''
    if (sourceUrl === '' || sourceUrl === lastAutoIdentifyUrlRef.current) {
      return
    }
    lastAutoIdentifyUrlRef.current = sourceUrl
    navigate(SEARCH_PATH, { replace: true })
    void identifySourceUrl(sourceUrl)
  }, [identifySourceUrl, location.search, navigate])

  const confirmLeaveIfDirty = () => {
    if (query.trim() !== '' || results.length > 0) {
      const shouldLeave = window.confirm('Cancel this suggestion and go back to songbook?')
      if (!shouldLeave) {
        return false
      }
    }
    return true
  }

  const leaveToSongbook = () => {
    if (!confirmLeaveIfDirty()) {
      return
    }
    resolvedOnCancel()
    navigate(BACK_TO_SONGBOOK_PATH)
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="suggest-search-header">
          <h1>Suggest a Song</h1>
          {isModal ? (
            <button
              type="button"
              className="icon-control-button"
              title="Close"
              aria-label="Close"
              onClick={leaveToSongbook}
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          ) : null}
        </div>
        {!isModal ? (
          <div className="row-actions top-gap">
            <button type="button" className="secondary" onClick={leaveToSongbook}>
              Back to Songbook
            </button>
          </div>
        ) : null}
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            if (shouldShowUrlPrompt) {
              handleIdentifyUrl()
              return
            }
            if (query.trim() !== '') {
              executeSearch(query)
            }
          }}
        >
          <label>
            <span className="sr-only">Search query or YouTube URL</span>
            <input
              className="suggest-search-input-flat"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter song keyword or URL"
            />
          </label>
        </form>
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}
        {shouldShowUrlPrompt ? (
          <div className="suggest-url-prompt top-gap">
            <p className="subtitle">
              You seem to have typed a YouTube URL. Do you want me to identify?
            </p>
            <button type="button" onClick={handleIdentifyUrl} disabled={isIdentifyingUrl}>
              {isIdentifyingUrl ? 'Identifying…' : 'Identify'}
            </button>
          </div>
        ) : null}
        {queryInfo !== '' ? <p className="subtitle top-gap">{queryInfo}</p> : null}
        {effectiveQuery !== '' ? (
          <p className="subtitle">
            Effective query: <code>{effectiveQuery}</code>
          </p>
        ) : null}
        <div className="queue-list top-gap">
          <SearchResultsList
            results={results}
            isSearching={isSearching}
            hidden={shouldShowUrlPrompt}
            onSelectResult={setSelectedResult}
          />
        </div>
        {selectedResult !== null ? (
          <SearchResultModal
            result={selectedResult}
            onClose={() => setSelectedResult(null)}
            onIdentify={requestIdentify}
          />
        ) : null}
        {pendingIdentifyResult !== null ? (
          <IdentifyOverrideModal
            result={pendingIdentifyResult}
            onCancel={clearPendingIdentifyResult}
            onConfirm={confirmPendingIdentify}
          />
        ) : null}
        {isIdentifyingUrl ? <BlockingHud message="Identifying song details..." /> : null}
      </section>
    </main>
  )
}
