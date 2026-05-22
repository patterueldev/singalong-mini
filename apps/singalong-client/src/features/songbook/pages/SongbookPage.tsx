import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminService } from '../../admin/hooks/useAdminService'
import { useGuestService } from '../../guest/hooks/useGuestService'
import {
  mergeDownloadProgressItems,
  normalizeDownloadProgressItems,
} from '../../shared/services/queueTransforms'
import { buildWSUrl } from '../../../shared/api/ws'
import { DownloadProgressModal } from '../components/DownloadProgressModal'
import { SkeletonList } from '../components/SkeletonList'
import { SongbookListItem } from '../components/SongbookListItem'
import type { DownloadProgressItem, SongbookSong, WSIncoming } from '../../../shared/types/client'

export type SongbookPageProps = {
  notice: string
  guestNickname: string | null
  onChangeNickname: () => void
}

export function SongbookPage({ notice, guestNickname, onChangeNickname }: SongbookPageProps) {
  const navigate = useNavigate()
  const { fetchSongbook, searchSongbook } = useAdminService()
  const { retryDownload: retrySongDownload } = useGuestService()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [downloadsSocketStatus, setDownloadsSocketStatus] = useState('Disconnected')
  const [retryingSongIds, setRetryingSongIds] = useState<string[]>([])
  const downloadsSocketRef = useRef<WebSocket | null>(null)
  const downloadsReconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectDownloadsRef = useRef(false)
  const downloadReconnectAttemptsRef = useRef(0)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(timer)
  }, [query])

  // Fetch when debounced query or page changes
  useEffect(() => {
    setIsLoading(true)
    const trimmed = debouncedQuery.trim()
    const fetchFn = trimmed === '' ? fetchSongbook(page) : searchSongbook(trimmed, page)
    fetchFn
      .then((data) => {
        setSongs(data.items)
        setPages(data.pages)
      })
      .catch(() => setSongs([]))
      .finally(() => setIsLoading(false))
  }, [debouncedQuery, page])

  // Reset to page 1 on new query
  useEffect(() => {
    setPage(1)
  }, [debouncedQuery])

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

  const handleSongClick = (song: SongbookSong) => {
    navigate(`/songbook/song/${song.id}`)
  }

  const handleRetryDownload = useCallback((songId: string) => {
    setRetryingSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
    void retrySongDownload(songId)
      .then(() => {
        setDownloadItems((items) =>
          items.map((item) =>
            item.songId === songId
              ? {
                  ...item,
                  status: 'pending',
                  progressPct: null,
                  progressMessage: 'Waiting in queue',
                  errorMessage: null,
                }
              : item,
          ),
        )
      })
      .finally(() => {
        setRetryingSongIds((current) => current.filter((entry) => entry !== songId))
      })
  }, [])

  const trimmedQuery = debouncedQuery.trim()

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            {guestNickname !== null ? (
              <p className="subtitle">
                Signed in as <strong>{guestNickname}</strong>
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setIsDownloadsModalOpen(true)}
            >
              Download Progress
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  guestNickname !== null
                    ? '/songbook/suggest/search'
                    : '/songbook/suggest/login',
                )
              }
            >
              Suggest a Song
            </button>
          </div>
        </div>

        {notice !== '' ? <p className="success-message top-gap">{notice}</p> : null}

        <div className="form top-gap">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, artist, genre, tags, etc."
          />
        </div>

        <div className="queue-list top-gap">
          {isLoading ? (
            <SkeletonList count={8} />
          ) : songs.length === 0 ? (
            trimmedQuery !== '' ? (
              <div>
                <p className="empty-state">"{trimmedQuery}" is not available. Would you like to suggest?</p>
                <div className="row-actions top-gap">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigate(`/songbook/suggest/search?keyword=${encodeURIComponent(trimmedQuery)}`)}
                  >
                    Suggest
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty-state">No songs found. Try suggesting a new one.</p>
            )
          ) : (
            songs.map((song) => <SongbookListItem key={song.id} song={song} onClick={() => handleSongClick(song)} />)
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
      </section>

      {guestNickname !== null ? (
        <div className="change-nickname-outside">
          <button type="button" className="secondary small" onClick={onChangeNickname}>
            Change Nickname
          </button>
        </div>
      ) : null}

      <DownloadProgressModal
        isOpen={isDownloadsModalOpen}
        status={downloadsSocketStatus}
        items={downloadItems}
        retryingSongIds={retryingSongIds}
        onClose={() => setIsDownloadsModalOpen(false)}
        onRetryDownload={handleRetryDownload}
      />
    </main>
  )
}
