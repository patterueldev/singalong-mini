import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSuggestSearchFlow } from '../../suggest/hooks/useSuggestSearchFlow'
import { IdentifyOverrideModal } from '../../suggest/components/IdentifyOverrideModal'
import { SearchResultModal } from '../../suggest/components/SearchResultModal'
import { SearchResultsList } from '../../suggest/components/SearchResultsList'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import type { SuggestDraft, SuggestResult } from '../../../shared/types/client'

const SEARCH_PATH = '/songbook/suggest/search'
const UPDATE_PATH = '/songbook/suggest/update'
const BACK_TO_SONGBOOK_PATH = '/songbook'

type SongbookSuggestSearchPageProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onIdentifyDraft: (draft: SuggestDraft) => void
}

export function SongbookSuggestSearchPage({
  nickname,
  authToken,
  onCancel,
  onIdentifyDraft,
}: SongbookSuggestSearchPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const lastAutoIdentifyUrlRef = useRef('')
  const [selectedResult, setSelectedResult] = useState<SuggestResult | null>(null)

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
    onIdentified: (draft) => {
      onIdentifyDraft(draft)
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

  return (
    <main className="app-shell">
      <section className="card">
        <div className="suggest-search-header">
          <h1>Suggest · Search YouTube</h1>
        </div>
        <p className="subtitle">Signed in as <strong>{nickname}</strong></p>
        <div className="row-actions top-gap">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!confirmLeaveIfDirty()) {
                return
              }
              onCancel()
              navigate(BACK_TO_SONGBOOK_PATH)
            }}
          >
            Back to Songbook
          </button>
        </div>
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
            Search query or YouTube URL
            <input
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
