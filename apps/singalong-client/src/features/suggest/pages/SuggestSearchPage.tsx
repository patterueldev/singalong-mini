import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSuggestService } from '../hooks/useSuggestService'
import { normalizeSuggestQuery } from '../../../shared/lib/suggest'
import type { SuggestResult } from '../../../shared/types/client'
import { IdentifyOverrideModal } from '../components/IdentifyOverrideModal'
import { SearchResultModal } from '../components/SearchResultModal'

type SuggestSearchPageProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
  onIdentify: (sourceUrl: string) => void
}

function SkeletonSongItem() {
  return (
    <div className="skeleton-item">
      <div className="skeleton skeleton-thumb" />
      <div className="skeleton-info">
        <div className="skeleton skeleton-line skeleton-line--title" />
        <div className="skeleton skeleton-line skeleton-line--meta" />
      </div>
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonSongItem key={i} />
      ))}
    </>
  )
}

export function SuggestSearchPage({
  nickname,
  authToken,
  onCancel,
  onChangeNickname,
  onIdentify,
}: SuggestSearchPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { search: suggestSearch } = useSuggestService()
  const lastSearchedKeywordRef = useRef('')
  const [query, setQuery] = useState('')
  const [effectiveQuery, setEffectiveQuery] = useState('')
  const [queryInfo, setQueryInfo] = useState('')
  const [results, setResults] = useState<SuggestResult[]>([])
  const [selectedResult, setSelectedResult] = useState<SuggestResult | null>(null)
  const [pendingIdentifyResult, setPendingIdentifyResult] = useState<SuggestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  const requestIdentify = useCallback(
    (result: SuggestResult) => {
      if (result.existsInSongbook === true) {
        setPendingIdentifyResult(result)
        return
      }

      onIdentify(result.sourceUrl)
    },
    [onIdentify],
  )

  const executeSearch = useCallback(
    (searchQuery: string) => {
      const normalized = normalizeSuggestQuery(searchQuery)
      if (normalized.effectiveQuery === '') {
        setQueryInfo('Please enter a search query.')
        setResults([])
        setEffectiveQuery('')
        lastSearchedKeywordRef.current = ''
        return
      }

      setErrorMessage('')
      setIsSearching(true)
      lastSearchedKeywordRef.current = searchQuery.trim()

      void suggestSearch(normalized.effectiveQuery, authToken)
        .then((response) => {
          setEffectiveQuery(response.effective_query)
          setQueryInfo(
            response.appended_karaoke ? 'Backend appended "karaoke" to the query.' : '',
          )
          setResults(
            response.results.map((item) => ({
              id: item.id,
              title: item.title,
              channelName: item.channel_name,
              channelUrl: item.channel_url,
              thumbnailUrl: item.thumbnail_url,
              duration: item.duration,
              description: item.description,
              viewCount: item.view_count,
              uploadedAt: item.uploaded_at,
              existsInSongbook: item.exists_in_songbook,
              sourceUrl: item.source_url,
              youtubeId: item.youtube_id,
            })),
          )
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Search failed'
          setErrorMessage(message)
          setEffectiveQuery(normalized.effectiveQuery)
          setQueryInfo('')
          setResults([])
        })
        .finally(() => {
          setIsSearching(false)
        })
    },
    [authToken],
  )

  useEffect(() => {
    const keyword = new URLSearchParams(location.search).get('keyword') ?? ''
    if (keyword !== '' && keyword.trim() !== lastSearchedKeywordRef.current) {
      setQuery(keyword)
      executeSearch(keyword)
    }
  }, [executeSearch, location.search])

  return (
    <main className="app-shell">
      <section className="card">
        <h1>Suggest · Search YouTube</h1>
        <p className="subtitle">Signed in as <strong>{nickname}</strong></p>
        <div className="row-actions top-gap">
          <button type="button" className="secondary" onClick={onChangeNickname}>
            Change Nickname
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (query.trim() !== '' || results.length > 0) {
                const shouldLeave = window.confirm(
                  'Cancel this suggestion and go back to songbook?',
                )
                if (!shouldLeave) {
                  return
                }
              }
              onCancel()
              navigate('/songbook')
            }}
          >
            Back to Songbook
          </button>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            const normalized = normalizeSuggestQuery(query)
            if (normalized.effectiveQuery === '') {
              setQueryInfo('Please enter a search query.')
              setResults([])
              setEffectiveQuery('')
              return
            }
            navigate({
              pathname: '/songbook/suggest/search',
              search: `?keyword=${encodeURIComponent(query.trim())}`,
            })
            executeSearch(query)
          }}
        >
          <label>
            Search query
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="song title"
              required
            />
          </label>
          <div className="row-actions">
            <button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching…' : 'Search'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => navigate('/songbook/suggest/identify')}
            >
              Paste URL Instead
            </button>
          </div>
        </form>
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}
        {queryInfo !== '' ? <p className="subtitle top-gap">{queryInfo}</p> : null}
        {effectiveQuery !== '' ? (
          <p className="subtitle">
            Effective query: <code>{effectiveQuery}</code>
          </p>
        ) : null}
        <div className="queue-list top-gap">
          {isSearching ? (
            <SkeletonList count={5} />
          ) : results.length === 0 ? (
            null
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="search-result-row"
                onClick={() => setSelectedResult(result)}
              >
                <img className="search-result-thumb" src={result.thumbnailUrl} alt={result.title} />
                <div className="search-result-content">
                  <strong className="search-result-title" title={result.title}>
                    {result.title}
                  </strong>
                  <p className="search-result-meta">
                    {result.duration} - {result.channelName}
                  </p>
                  {result.existsInSongbook === true ? (
                    <p className="search-result-exists">✔ Already in songbook</p>
                  ) : null}
                </div>
              </button>
            ))
          )}
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
            onCancel={() => setPendingIdentifyResult(null)}
            onConfirm={() => {
              onIdentify(pendingIdentifyResult.sourceUrl)
              setPendingIdentifyResult(null)
            }}
          />
        ) : null}
      </section>
    </main>
  )
}
