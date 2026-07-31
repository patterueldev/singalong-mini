import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { adminService } from '../../admin/services/adminService'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestReserveSong } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import { buildInitialSuggestDraft, mapSuggestSearchItem, parseYouTubeVideoId } from '../../../shared/lib/suggest'
import type { SongbookSong, SuggestResult } from '../../../shared/types/client'
import { SongDetailsModal } from '../../songbook/components/SongDetailsModal'
import { SongbookListItem } from '../../songbook/components/SongbookListItem'
import { useSuggestService } from '../../suggest/hooks/useSuggestService'
import { SearchResultsList } from '../../suggest/components/SearchResultsList'
import { SearchResultModal } from '../../suggest/components/SearchResultModal'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import { saveSuggestDraft } from '../../../shared/storage/suggestStorage'

const SONGS_PATH = '/songs'
const DRAFT_PATH = '/songs/draft'

type GuestSongDetailModalProps = {
  songId: string
  sessionCode: string
  authToken: string
  onClose: () => void
  onReserved: () => void
}

function GuestSongDetailModal({
  songId,
  sessionCode,
  authToken,
  onClose,
  onReserved,
}: GuestSongDetailModalProps) {
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isReserving, setIsReserving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setErrorMessage('')
    void adminService
      .fetchSongDetail(songId, sessionCode)
      .then((payload) => {
        if (!cancelled) {
          setSong(payload)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Song does not exist')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionCode, songId])

  const handleReserve = async () => {
    if (song === null) return
    setErrorMessage('')
    setIsReserving(true)
    try {
      await guestReserveSong(sessionCode, song.id, authToken)
      onReserved()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reserve song')
    } finally {
      setIsReserving(false)
    }
  }

  return (
    <SongDetailsModal
      isOpen
      song={song}
      isLoading={isLoading}
      errorMessage={errorMessage}
      onClose={onClose}
      onReserve={() => void handleReserve()}
      isReserving={isReserving}
      reserveDisabled={song === null}
    />
  )
}

export function GuestSongbookPage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  const { search: suggestSearch, identify: suggestIdentify, download: suggestDownload } = useSuggestService()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('query') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('query') ?? '')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [activeSongId, setActiveSongId] = useState<string | null>(null)
  const [isYoutubeSearchActive, setIsYoutubeSearchActive] = useState(false)
  const [youtubeResults, setYoutubeResults] = useState<SuggestResult[]>([])
  const [isSearchingYoutube, setIsSearchingYoutube] = useState(false)
  const [youtubeAppendedKaraoke, setYoutubeAppendedKaraoke] = useState(false)
  const [isProcessingResult, setIsProcessingResult] = useState(false)
  const [detailsResult, setDetailsResult] = useState<SuggestResult | null>(null)
  const latestYoutubeQueryRef = useRef('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const songsPath = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedQuery !== '') {
      params.set('query', debouncedQuery)
    }
    const search = params.toString()
    return search === '' ? SONGS_PATH : `${SONGS_PATH}?${search}`
  }, [debouncedQuery])

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode)) {
      return
    }
    navigate(songsPath, { replace: true })
  }, [hasGuestSession, navigate, sessionCode, songsPath])

  useEffect(() => {
    setPage(1)
    setIsYoutubeSearchActive(false)
    setYoutubeResults([])
    setYoutubeAppendedKaraoke(false)
  }, [debouncedQuery])

  const handleSearchYoutube = useCallback(
    (searchQuery: string) => {
      if (searchQuery === '' || guestAuth === null) return
      latestYoutubeQueryRef.current = searchQuery
      setIsYoutubeSearchActive(true)
      setIsSearchingYoutube(true)
      setYoutubeAppendedKaraoke(false)
      setErrorMessage('')
      void suggestSearch(searchQuery, guestAuth.accessToken)
        .then((response) => {
          if (latestYoutubeQueryRef.current !== searchQuery) return
          setYoutubeResults(response.results.map(mapSuggestSearchItem))
          setYoutubeAppendedKaraoke(response.appended_karaoke)
        })
        .catch((error: unknown) => {
          if (latestYoutubeQueryRef.current !== searchQuery) return
          setYoutubeResults([])
          setErrorMessage(error instanceof Error ? error.message : 'YouTube search failed')
        })
        .finally(() => {
          if (latestYoutubeQueryRef.current !== searchQuery) return
          setIsSearchingYoutube(false)
        })
    },
    [guestAuth, suggestSearch],
  )

  const resolveYoutubeUrl = useCallback(
    async (sourceUrl: string) => {
      if (guestAuth === null) return
      setIsYoutubeSearchActive(false)
      setYoutubeResults([])
      setYoutubeAppendedKaraoke(false)
      setErrorMessage('')
      try {
        const response = await suggestSearch(sourceUrl, guestAuth.accessToken)
        const [item] = response.results.map(mapSuggestSearchItem)
        if (item === undefined) {
          setSongs([])
          setErrorMessage('Could not resolve that YouTube link.')
          return
        }
        if (item.existingSongId !== null) {
          const song = await adminService.fetchSongDetail(item.existingSongId, sessionCode)
          setSongs([song])
        } else {
          setSongs([])
          setIsYoutubeSearchActive(true)
          setYoutubeResults([item])
        }
      } catch (error) {
        setSongs([])
        setErrorMessage(error instanceof Error ? error.message : 'Failed to resolve that YouTube link')
      }
    },
    [guestAuth, sessionCode, suggestSearch],
  )

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode)) {
      setSongs([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage('')

    const trimmed = debouncedQuery.trim()

    if (parseYouTubeVideoId(trimmed) !== null) {
      setPages(1)
      void resolveYoutubeUrl(trimmed).finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })
      return () => {
        cancelled = true
      }
    }

    const request =
      trimmed === ''
        ? adminService.fetchSongbook(page, 20, sessionCode)
        : adminService.searchSongbook(trimmed, page, 20, sessionCode)

    void request
      .then((payload) => {
        if (cancelled) return
        setSongs(payload.items)
        setPages(payload.pages)
        if (payload.items.length === 0 && trimmed !== '') {
          handleSearchYoutube(trimmed)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSongs([])
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load songbook')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, handleSearchYoutube, hasGuestSession, page, resolveYoutubeUrl, sessionCode])

  const activeSongbookCount = useMemo(() => songs.length, [songs])
  const trimmedQuery = debouncedQuery.trim()

  const reserveExistingSong = async (songId: string) => {
    if (guestAuth === null || !isValidSessionCode(sessionCode)) return
    setIsProcessingResult(true)
    setErrorMessage('')
    try {
      await guestReserveSong(sessionCode, songId, guestAuth.accessToken)
      setMessage('Song reserved.')
      navigate('/home', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reserve song')
    } finally {
      setIsProcessingResult(false)
    }
  }

  const identifyAndReserve = async (sourceUrl: string) => {
    if (guestAuth === null || !isValidSessionCode(sessionCode)) return
    setIsProcessingResult(true)
    setErrorMessage('')
    try {
      const response = await suggestIdentify(sourceUrl, guestAuth.accessToken)
      const draft = buildInitialSuggestDraft(response)
      if (draft.isLikelySong === false) {
        saveSuggestDraft(draft)
        navigate(DRAFT_PATH, { state: { returnTo: songsPath } })
        return
      }
      await suggestDownload(draft, guestAuth.accessToken, { reserveSessionCode: sessionCode })
      setMessage('Song added — it will appear in your queue once it finishes downloading.')
      navigate('/home', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add song')
    } finally {
      setIsProcessingResult(false)
    }
  }

  const identifyAndEdit = async (sourceUrl: string) => {
    if (guestAuth === null) return
    setIsProcessingResult(true)
    setErrorMessage('')
    try {
      const response = await suggestIdentify(sourceUrl, guestAuth.accessToken)
      saveSuggestDraft(buildInitialSuggestDraft(response))
      navigate(DRAFT_PATH, { state: { returnTo: songsPath } })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to identify video')
    } finally {
      setIsProcessingResult(false)
    }
  }

  const reserveYoutubeResult = (result: SuggestResult) => {
    if (result.existingSongId !== null) {
      void reserveExistingSong(result.existingSongId)
      return
    }
    void identifyAndReserve(result.sourceUrl)
  }

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/join" replace />
  }

  return (
    <main className="app-shell guest-fullscreen-shell">
      <section className="card guest-fullscreen-card guest-songbook-screen">
        <div className="guest-songbook-sticky-top">
          <div className="guest-songbook-search-row">
            <input
              className="songbook-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs..."
            />
            <div className="row-actions guest-songbook-header-actions">
              <button
                type="button"
                className="icon-control-button"
                aria-label="Close songbook"
                onClick={() => navigate('/home')}
              >
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          </div>
        </div>

        {message !== '' ? <p className="success-message">{message}</p> : null}
        {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}

        <div className="guest-scroll-content">
          {isLoading ? (
            <p className="empty-state">Loading songbook…</p>
          ) : activeSongbookCount === 0 ? (
            trimmedQuery !== '' ? (
              <p className="empty-state">
                {parseYouTubeVideoId(trimmedQuery) !== null
                  ? 'This URL is not available in the songbook.'
                  : `"${trimmedQuery}" is not available in the songbook.`}
              </p>
            ) : (
              <p className="empty-state">No songs found.</p>
            )
          ) : (
            <div className="queue-list songbook-list guest-songbook-list">
              {songs.map((song) => (
                <SongbookListItem
                  key={song.id}
                  song={song}
                  onClick={() => setActiveSongId(song.id)}
                  menu={{
                    onReserve: () => void reserveExistingSong(song.id),
                    onViewDetails: () => setActiveSongId(song.id),
                  }}
                  badge={
                    song.wasQueuedInSession ? (
                      Math.max(song.queuedCountInSession, 1) === 1 ? (
                        <span className="songbook-played-indicator one" aria-label="Played once">
                          <span className="material-symbols-outlined" aria-hidden="true">
                            check_circle
                          </span>
                        </span>
                      ) : (
                        <span className="songbook-played-indicator many" aria-label="Played multiple times">
                          {Math.max(song.queuedCountInSession, 1)}
                        </span>
                      )
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}

          {pages > 1 ? (
            <div className="pagination songbook-pagination top-gap">
              <button type="button" className="pagination-arrow-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                ‹
              </button>
              <span className="pagination-info">
                Page {page} / {pages}
              </span>
              <button type="button" className="pagination-arrow-button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>
                ›
              </button>
            </div>
          ) : null}

          {!isLoading &&
          trimmedQuery !== '' &&
          activeSongbookCount > 0 &&
          !isYoutubeSearchActive &&
          parseYouTubeVideoId(trimmedQuery) === null ? (
            <div className="row-actions top-gap">
              <button type="button" className="secondary" onClick={() => handleSearchYoutube(trimmedQuery)}>
                Didn't find the song? Search YouTube
              </button>
            </div>
          ) : null}

          {isYoutubeSearchActive ? (
            <div className="top-gap">
              <h2 className="section-subheading">YouTube results</h2>
              {!isSearchingYoutube && youtubeAppendedKaraoke ? (
                <div className="chip-suggestion-list top-gap">
                  <button
                    type="button"
                    className="chip-suggestion"
                    onClick={() => handleSearchYoutube(`${trimmedQuery} カラオケ`)}
                  >
                    Try "{trimmedQuery} カラオケ"
                  </button>
                </div>
              ) : null}
              <div className="queue-list top-gap">
                <SearchResultsList
                  results={youtubeResults}
                  isSearching={isSearchingYoutube}
                  onSelectResult={reserveYoutubeResult}
                  menu={(result) => ({
                    onReserve: () => reserveYoutubeResult(result),
                    onPreview: () => setDetailsResult(result),
                    onEnhanceDetails:
                      result.existingSongId === null ? () => void identifyAndEdit(result.sourceUrl) : undefined,
                  })}
                />
              </div>
              {!isSearchingYoutube && youtubeResults.length === 0 ? (
                <p className="empty-state">No YouTube results found.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {activeSongId !== null ? (
        <GuestSongDetailModal
          songId={activeSongId}
          sessionCode={sessionCode}
          authToken={guestAuth.accessToken}
          onClose={() => setActiveSongId(null)}
          onReserved={() => {
            setActiveSongId(null)
            setMessage('Song reserved.')
            navigate('/home', { replace: true })
          }}
        />
      ) : null}

      {detailsResult !== null ? (
        <SearchResultModal
          result={detailsResult}
          onClose={() => setDetailsResult(null)}
          onReserve={() => {
            const result = detailsResult
            setDetailsResult(null)
            reserveYoutubeResult(result)
          }}
          identifyLabel="Enhance Details"
          onIdentify={
            detailsResult.existingSongId === null
              ? (result) => {
                  setDetailsResult(null)
                  void identifyAndEdit(result.sourceUrl)
                }
              : undefined
          }
        />
      ) : null}

      {isProcessingResult ? <BlockingHud message="Processing Song…" /> : null}
    </main>
  )
}
