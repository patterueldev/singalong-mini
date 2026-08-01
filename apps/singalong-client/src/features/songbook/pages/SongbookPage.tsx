import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAdminService } from '../../admin/hooks/useAdminService'
import { useSuggestService } from '../../suggest/hooks/useSuggestService'
import {
  mergeDownloadProgressItems,
  normalizeDownloadProgressItems,
} from '../../shared/services/queueTransforms'
import { buildWSUrl } from '../../../shared/api/ws'
import { buildInitialSuggestDraft, mapSuggestSearchItem, parseYouTubeVideoId } from '../../../shared/lib/suggest'
import { saveSuggestDraft } from '../../../shared/storage/suggestStorage'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import { DuplicateWarningModal } from '../../suggest/components/DuplicateWarningModal'
import { SearchResultModal } from '../../suggest/components/SearchResultModal'
import { SearchResultsList } from '../../suggest/components/SearchResultsList'
import { DownloadProgressModal } from '../components/DownloadProgressModal'
import { SkeletonList } from '../components/SkeletonList'
import { SongbookListItem } from '../components/SongbookListItem'
import type {
  DownloadProgressItem,
  SongbookSong,
  SuggestDraft,
  SuggestResult,
  WSIncoming,
} from '../../../shared/types/client'

const SONGBOOK_PATH = '/songbook'
const DRAFT_PATH = '/songbook/draft'

export type SongbookPageProps = {
  notice: string
  guestNickname: string
  authToken: string
}

export function SongbookPage({ notice, guestNickname, authToken }: SongbookPageProps) {
  const navigate = useNavigate()
  const { fetchSongbook, searchSongbook, fetchSongDetail } = useAdminService()
  const { search: suggestSearch, identify: suggestIdentify, download: suggestDownload } = useSuggestService()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('query') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('query') ?? '')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [isYoutubeSearchActive, setIsYoutubeSearchActive] = useState(false)
  const [youtubeResults, setYoutubeResults] = useState<SuggestResult[]>([])
  const [isSearchingYoutube, setIsSearchingYoutube] = useState(false)
  const [youtubeAppendedKaraoke, setYoutubeAppendedKaraoke] = useState(false)
  const [isProcessingResult, setIsProcessingResult] = useState(false)
  const [detailsResult, setDetailsResult] = useState<SuggestResult | null>(null)
  const [pendingDuplicate, setPendingDuplicate] = useState<SuggestDraft | null>(null)
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [downloadsSocketStatus, setDownloadsSocketStatus] = useState('Disconnected')
  const latestYoutubeQueryRef = useRef('')
  const downloadsSocketRef = useRef<WebSocket | null>(null)
  const downloadsReconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectDownloadsRef = useRef(false)
  const downloadReconnectAttemptsRef = useRef(0)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(timer)
  }, [query])

  const songbookPath = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedQuery !== '') {
      params.set('query', debouncedQuery)
    }
    const search = params.toString()
    return search === '' ? SONGBOOK_PATH : `${SONGBOOK_PATH}?${search}`
  }, [debouncedQuery])

  // Keep the URL in sync so a refresh — or coming back from the review screen —
  // restores the search the visitor left.
  useEffect(() => {
    navigate(songbookPath, { replace: true })
  }, [navigate, songbookPath])

  // Reset paging and the YouTube fallback on every new query
  useEffect(() => {
    setPage(1)
    setIsYoutubeSearchActive(false)
    setYoutubeResults([])
    setYoutubeAppendedKaraoke(false)
  }, [debouncedQuery])

  const handleSearchYoutube = useCallback(
    (searchQuery: string) => {
      if (searchQuery === '') return
      latestYoutubeQueryRef.current = searchQuery
      setIsYoutubeSearchActive(true)
      setIsSearchingYoutube(true)
      setYoutubeAppendedKaraoke(false)
      setErrorMessage('')
      void suggestSearch(searchQuery, authToken)
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
    [authToken, suggestSearch],
  )

  const resolveYoutubeUrl = useCallback(
    async (sourceUrl: string) => {
      setIsYoutubeSearchActive(false)
      setYoutubeResults([])
      setYoutubeAppendedKaraoke(false)
      setErrorMessage('')
      try {
        const response = await suggestSearch(sourceUrl, authToken)
        const [item] = response.results.map(mapSuggestSearchItem)
        if (item === undefined) {
          setSongs([])
          setErrorMessage('Could not resolve that YouTube link.')
          return
        }
        if (item.existingSongId !== null) {
          const song = await fetchSongDetail(item.existingSongId)
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
    [authToken, fetchSongDetail, suggestSearch],
  )

  // Fetch the songbook, falling back to YouTube when nothing matches
  useEffect(() => {
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

    const request = trimmed === '' ? fetchSongbook(page) : searchSongbook(trimmed, page)

    void request
      .then((data) => {
        if (cancelled) return
        setSongs(data.items)
        setPages(data.pages)
        if (data.items.length === 0 && trimmed !== '') {
          handleSearchYoutube(trimmed)
        }
      })
      .catch((error) => {
        if (cancelled) return
        setSongs([])
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load songbook')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    debouncedQuery,
    fetchSongbook,
    handleSearchYoutube,
    page,
    refreshToken,
    resolveYoutubeUrl,
    searchSongbook,
  ])

  const clearDownloadsReconnectTimer = useCallback(() => {
    if (downloadsReconnectTimerRef.current !== null) {
      window.clearTimeout(downloadsReconnectTimerRef.current)
      downloadsReconnectTimerRef.current = null
    }
  }, [])

  const closeDownloadsSocket = useCallback(() => {
    const socket = downloadsSocketRef.current
    downloadsSocketRef.current = null
    if (socket !== null) {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (!isDownloadsModalOpen) {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
      setDownloadsSocketStatus('Disconnected')
      return
    }

    shouldReconnectDownloadsRef.current = true
    downloadReconnectAttemptsRef.current = 0

    const scheduleReconnect = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }
      clearDownloadsReconnectTimer()
      const delaySeconds = Math.min(2 ** downloadReconnectAttemptsRef.current, 8)
      downloadReconnectAttemptsRef.current += 1
      setDownloadsSocketStatus(`Reconnecting in ${delaySeconds}s...`)
      downloadsReconnectTimerRef.current = window.setTimeout(() => {
        downloadsReconnectTimerRef.current = null
        connectSocket()
      }, delaySeconds * 1000)
    }

    const connectSocket = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }

      setDownloadsSocketStatus('Connecting...')
      const socket = new WebSocket(buildWSUrl('/ws/guest', {}))
      downloadsSocketRef.current = socket

      socket.onopen = () => {
        downloadReconnectAttemptsRef.current = 0
        setDownloadsSocketStatus('Connected')
      }

      socket.onclose = () => {
        if (!shouldReconnectDownloadsRef.current) {
          setDownloadsSocketStatus('Disconnected')
          return
        }
        scheduleReconnect()
      }

      socket.onerror = () => {
        setDownloadsSocketStatus('Connection error')
      }

      socket.onmessage = (event) => {
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }
        if (payload.type !== 'downloads.updated') {
          return
        }
        const incoming = normalizeDownloadProgressItems(payload.payload.items)
        setDownloadItems((previous) => mergeDownloadProgressItems(previous, incoming))
      }
    }

    connectSocket()
    return () => {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
    }
  }, [isDownloadsModalOpen, clearDownloadsReconnectTimer, closeDownloadsSocket])

  const trimmedQuery = debouncedQuery.trim()

  const finishDownload = async (draft: SuggestDraft) => {
    setIsProcessingResult(true)
    setErrorMessage('')
    try {
      await suggestDownload(draft, authToken)
      setMessage(`${draft.title} is now downloading!`)
      setIsYoutubeSearchActive(false)
      setYoutubeResults([])
      setQuery('')
      setDebouncedQuery('')
      setRefreshToken((current) => current + 1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add song')
    } finally {
      setIsProcessingResult(false)
    }
  }

  const identifyAndDownload = async (sourceUrl: string) => {
    setIsProcessingResult(true)
    setErrorMessage('')
    setMessage('')
    try {
      const response = await suggestIdentify(sourceUrl, authToken)
      const draft = buildInitialSuggestDraft(response)
      if (draft.isLikelySong === false) {
        saveSuggestDraft(draft)
        navigate(DRAFT_PATH, { state: { returnTo: songbookPath } })
        return
      }
      const blockingMatch = (draft.possibleDuplicates ?? []).some(
        (match) => match.confidence === 'exact' || match.confidence === 'high',
      )
      if (blockingMatch) {
        setPendingDuplicate(draft)
        return
      }
      await finishDownload(draft)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add song')
    } finally {
      setIsProcessingResult(false)
    }
  }

  const identifyAndEdit = async (sourceUrl: string) => {
    setIsProcessingResult(true)
    setErrorMessage('')
    setMessage('')
    try {
      const response = await suggestIdentify(sourceUrl, authToken)
      saveSuggestDraft(buildInitialSuggestDraft(response))
      navigate(DRAFT_PATH, { state: { returnTo: songbookPath } })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to identify video')
    } finally {
      setIsProcessingResult(false)
    }
  }

  // Already in the songbook? There is nothing to download — show its details instead.
  const downloadYoutubeResult = (result: SuggestResult) => {
    if (result.existingSongId !== null) {
      navigate(`/songbook/song/${result.existingSongId}`)
      return
    }
    void identifyAndDownload(result.sourceUrl)
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            <p className="subtitle">
              Signed in as <strong>{guestNickname}</strong>
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setIsDownloadsModalOpen(true)}
            >
              Download Progress
            </button>
          </div>
        </div>

        {notice !== '' ? <p className="success-message top-gap">{notice}</p> : null}
        {message !== '' ? <p className="success-message top-gap">{message}</p> : null}
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}

        <div className="form top-gap">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search songs, or paste a YouTube link"
          />
        </div>

        <div className="queue-list top-gap">
          {isLoading ? (
            <SkeletonList count={8} />
          ) : songs.length === 0 ? (
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
            songs.map((song) => (
              <SongbookListItem key={song.id} song={song} onClick={() => navigate(`/songbook/song/${song.id}`)} />
            ))
          )}
        </div>

        {pages > 1 ? (
          <div className="pagination top-gap">
            <button
              type="button"
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span className="pagination-info">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        ) : null}

        {!isLoading &&
        trimmedQuery !== '' &&
        songs.length > 0 &&
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
                onSelectResult={downloadYoutubeResult}
                menu={(result) => ({
                  primaryLabel: result.existingSongId === null ? 'Download' : 'Details',
                  onReserve: () => downloadYoutubeResult(result),
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
      </section>

      {detailsResult !== null ? (
        <SearchResultModal
          result={detailsResult}
          onClose={() => setDetailsResult(null)}
          reserveLabel={detailsResult.existingSongId === null ? 'Download' : 'Details'}
          onReserve={() => {
            const result = detailsResult
            setDetailsResult(null)
            downloadYoutubeResult(result)
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

      {pendingDuplicate !== null ? (
        <DuplicateWarningModal
          draft={pendingDuplicate}
          matches={pendingDuplicate.possibleDuplicates ?? []}
          description="This looks like it might already be in the songbook. Open the existing song, or add this video anyway as a separate entry."
          existingActionLabel="View this one"
          onReserveExisting={(songId) => {
            setPendingDuplicate(null)
            navigate(`/songbook/song/${songId}`)
          }}
          onAddAnyway={() => {
            const draft = pendingDuplicate
            setPendingDuplicate(null)
            void finishDownload(draft)
          }}
          onCancel={() => setPendingDuplicate(null)}
        />
      ) : null}

      {isProcessingResult ? <BlockingHud message="Processing Song…" /> : null}

      <DownloadProgressModal
        isOpen={isDownloadsModalOpen}
        status={downloadsSocketStatus}
        items={downloadItems}
        onClose={() => setIsDownloadsModalOpen(false)}
      />
    </main>
  )
}
