import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSuggestService } from '../hooks/useSuggestService'
import { buildInitialSuggestDraft, normalizeSuggestQuery, parseYouTubeVideoId } from '../../../shared/lib/suggest'
import type { SuggestDraft, SuggestResult } from '../../../shared/types/client'
import { IdentifyOverrideModal } from '../components/IdentifyOverrideModal'
import { SearchResultModal } from '../components/SearchResultModal'
import { BlockingHud } from '../components/BlockingHud'

type SuggestSearchPageProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
  onIdentify: (sourceUrl: string) => void
  searchPath?: string
  identifyPath?: string
  backToSongbookPath?: string
  backToSongbookLabel?: string
  showChangeNicknameAction?: boolean
  singlePageUrlIdentify?: boolean
  onIdentifyDraft?: (draft: SuggestDraft) => void
  updatePath?: string
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
  searchPath = '/songbook/suggest/search',
  identifyPath = '/songbook/suggest/identify',
  updatePath = '/songbook/suggest/update',
  backToSongbookPath = '/songbook',
  backToSongbookLabel = 'Back to Songbook',
  showChangeNicknameAction = true,
  singlePageUrlIdentify = false,
  onIdentifyDraft,
}: SuggestSearchPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { search: suggestSearch, identify: suggestIdentify } = useSuggestService()
  const lastSearchedKeywordRef = useRef('')
  const lastAutoIdentifyUrlRef = useRef('')
  const [query, setQuery] = useState('')
  const [effectiveQuery, setEffectiveQuery] = useState('')
  const [queryInfo, setQueryInfo] = useState('')
  const [results, setResults] = useState<SuggestResult[]>([])
  const [selectedResult, setSelectedResult] = useState<SuggestResult | null>(null)
  const [pendingIdentifyResult, setPendingIdentifyResult] = useState<SuggestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isIdentifyingUrl, setIsIdentifyingUrl] = useState(false)
  const isYouTubeUrlQuery = parseYouTubeVideoId(query) !== null
  const shouldShowUrlPrompt = singlePageUrlIdentify && query.trim() !== '' && isYouTubeUrlQuery

  const requestIdentify = useCallback(
    (result: SuggestResult) => {
      if (result.existsInSongbook === true) {
        setPendingIdentifyResult(result)
        return
      }

      if (singlePageUrlIdentify && onIdentifyDraft !== undefined) {
        setErrorMessage('')
        setIsIdentifyingUrl(true)
        void suggestIdentify(result.sourceUrl, authToken, true)
          .then((response) => {
            onIdentifyDraft(buildInitialSuggestDraft(response))
            navigate(updatePath, { replace: true })
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Identify failed'
            setErrorMessage(message)
          })
          .finally(() => {
            setIsIdentifyingUrl(false)
          })
        return
      }

      onIdentify(result.sourceUrl)
    },
    [authToken, navigate, onIdentify, onIdentifyDraft, singlePageUrlIdentify, suggestIdentify, updatePath],
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
    const keyword = new URLSearchParams(location.search).get('keyword')?.trim() ?? ''
    if (keyword === '') {
      return
    }

    if (singlePageUrlIdentify) {
      setQuery(keyword)
      return
    }

    if (keyword !== lastSearchedKeywordRef.current) {
      setQuery(keyword)
      executeSearch(keyword)
    }
  }, [executeSearch, location.search, singlePageUrlIdentify])

  useEffect(() => {
    if (!singlePageUrlIdentify) {
      return
    }

    const trimmed = query.trim()
    if (trimmed === '') {
      setResults([])
      setEffectiveQuery('')
      setQueryInfo('')
      setErrorMessage('')
      return
    }

    if (parseYouTubeVideoId(trimmed) !== null) {
      setResults([])
      setEffectiveQuery('')
      setQueryInfo('')
      setErrorMessage('')
      return
    }

    const timeoutId = window.setTimeout(() => {
      executeSearch(trimmed)
    }, 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [executeSearch, query, singlePageUrlIdentify])

  useEffect(() => {
    if (!singlePageUrlIdentify || onIdentifyDraft === undefined) {
      return
    }
    const sourceUrl = new URLSearchParams(location.search).get('url')?.trim() ?? ''
    if (sourceUrl === '' || sourceUrl === lastAutoIdentifyUrlRef.current) {
      return
    }
    lastAutoIdentifyUrlRef.current = sourceUrl
    navigate(searchPath, { replace: true })
    setErrorMessage('')
    setIsIdentifyingUrl(true)
    void suggestIdentify(sourceUrl, authToken, true)
      .then((response) => {
        onIdentifyDraft(buildInitialSuggestDraft(response))
        navigate(updatePath, { replace: true })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Identify failed'
        setErrorMessage(message)
      })
      .finally(() => {
        setIsIdentifyingUrl(false)
      })
  }, [
    authToken,
    location.search,
    navigate,
    onIdentifyDraft,
    searchPath,
    singlePageUrlIdentify,
    suggestIdentify,
    updatePath,
  ])

  const handleIdentifyUrl = useCallback(() => {
    const normalizedUrl = query.trim()
    const videoId = parseYouTubeVideoId(normalizedUrl)
    if (videoId === null) {
      setErrorMessage('Enter a valid YouTube URL.')
      return
    }

    setErrorMessage('')
    setIsIdentifyingUrl(true)

    void suggestIdentify(normalizedUrl, authToken, true)
      .then((response) => {
        if (onIdentifyDraft !== undefined) {
          onIdentifyDraft(buildInitialSuggestDraft(response))
          navigate(updatePath, { replace: true })
          return
        }
        onIdentify(normalizedUrl)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Identify failed'
        setErrorMessage(message)
      })
      .finally(() => {
        setIsIdentifyingUrl(false)
      })
  }, [authToken, navigate, onIdentify, onIdentifyDraft, query, suggestIdentify, updatePath])

  return (
    <main className="app-shell">
      <section className="card">
        <h1>Suggest · Search YouTube</h1>
        <p className="subtitle">Signed in as <strong>{nickname}</strong></p>
        <div className="row-actions top-gap">
          {showChangeNicknameAction ? (
            <button type="button" className="secondary" onClick={onChangeNickname}>
              Change Nickname
            </button>
          ) : null}
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
              navigate(backToSongbookPath)
            }}
          >
            {backToSongbookLabel}
          </button>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            if (singlePageUrlIdentify) {
              if (shouldShowUrlPrompt) {
                handleIdentifyUrl()
                return
              }
              if (query.trim() !== '') {
                executeSearch(query)
              }
              return
            }
            const normalized = normalizeSuggestQuery(query)
            if (normalized.effectiveQuery === '') {
              setQueryInfo('Please enter a search query.')
              setResults([])
              setEffectiveQuery('')
              return
            }
            navigate({
              pathname: searchPath,
              search: `?keyword=${encodeURIComponent(query.trim())}`,
            })
            executeSearch(query)
          }}
        >
          <label>
            {singlePageUrlIdentify ? 'Search query or YouTube URL' : 'Search query'}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={singlePageUrlIdentify ? 'Enter song keyword or URL' : 'song title'}
              required={!singlePageUrlIdentify}
            />
          </label>
          {!singlePageUrlIdentify ? (
            <div className="row-actions">
              <button type="submit" disabled={isSearching}>
                {isSearching ? 'Searching…' : 'Search'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(identifyPath)}
              >
                Paste URL Instead
              </button>
            </div>
          ) : null}
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
          {shouldShowUrlPrompt ? null : isSearching ? (
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
              if (singlePageUrlIdentify && onIdentifyDraft !== undefined) {
                setErrorMessage('')
                setIsIdentifyingUrl(true)
                void suggestIdentify(pendingIdentifyResult.sourceUrl, authToken, true)
                  .then((response) => {
                    onIdentifyDraft(buildInitialSuggestDraft(response))
                    navigate(updatePath, { replace: true })
                  })
                  .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'Identify failed'
                    setErrorMessage(message)
                  })
                  .finally(() => {
                    setIsIdentifyingUrl(false)
                  })
              } else {
                onIdentify(pendingIdentifyResult.sourceUrl)
              }
              setPendingIdentifyResult(null)
            }}
          />
        ) : null}
        {isIdentifyingUrl ? <BlockingHud message="Identifying song details..." /> : null}
      </section>
    </main>
  )
}
