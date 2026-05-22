import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { adminService } from '../../admin/services/adminService'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestReserveSong } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type { SongbookSong } from '../../../shared/types/client'

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
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal guest-song-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song?.title ?? 'Song details'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row-actions guest-song-detail-top-actions">
          <button type="button" disabled={isReserving || isLoading || song === null} onClick={() => void handleReserve()}>
            {isReserving ? 'Reserving…' : 'Reserve'}
          </button>
          <button type="button" className="icon-control-button" aria-label="Close song details" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="guest-song-detail-scroll">
          {isLoading ? (
            <p className="empty-state top-gap">Loading song details…</p>
          ) : errorMessage !== '' ? (
            <p className="error-message top-gap">{errorMessage}</p>
          ) : song !== null ? (
            <div className="song-detail-layout">
              <div className="song-detail-video-panel">
                {song.videoFile ? (
                  <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
                ) : (
                  <p className="empty-state">Video not available.</p>
                )}
              </div>

              <div className="song-detail-summary-panel">
                <div className="song-detail-header-row">
                  {song.thumbnailUrl ? (
                    <img className="song-detail-thumbnail song-detail-thumbnail--small" src={song.thumbnailUrl} alt={song.title} />
                  ) : (
                    <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                  )}
                  <div className="song-detail-meta">
                    <h2 className="song-detail-title">{song.title}</h2>
                    <p className="subtitle">{song.artist}</p>
                  </div>
                </div>

                <dl className="song-detail-grid top-gap">
                  <div>
                    <dt>Language</dt>
                    <dd>{formatLanguageLabel(song.language)}</dd>
                  </div>
                  <div>
                    <dt>Genre</dt>
                    <dd>{song.genre ?? '—'}</dd>
                  </div>
                  <div className="song-detail-grid-wide">
                    <dt>Duration</dt>
                    <dd>{song.duration}</dd>
                  </div>
                </dl>

                <div className="song-detail-chips top-gap">
                  {song.language ? <span className="chip-badge">{formatLanguageLabel(song.language)}</span> : null}
                  {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                  {song.duration ? <span className="chip-badge">{song.duration}</span> : null}
                  {song.tags.map((tag) => (
                    <span key={tag} className="chip-badge chip-badge--tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="song-detail-lyrics-panel">
                <h3>Lyrics</h3>
                <p className="song-detail-lyrics">
                  {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function GuestSongbookPage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [activeSongId, setActiveSongId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setPage(1)
  }, [debouncedQuery])

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
    const request =
      trimmed === ''
        ? adminService.fetchSongbook(page, 20, sessionCode)
        : adminService.searchSongbook(trimmed, page, 20, sessionCode)

    void request
      .then((payload) => {
        if (cancelled) return
        setSongs(payload.items)
        setPages(payload.pages)
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
  }, [debouncedQuery, hasGuestSession, page, sessionCode])

  const activeSongbookCount = useMemo(() => songs.length, [songs])
  const trimmedQuery = debouncedQuery.trim()

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/guest/join" replace />
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
                aria-label="Suggest a song"
                title="Suggest a song"
                onClick={() => navigate('/guest/songbook/suggest/search')}
              >
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              </button>
              <button
                type="button"
                className="icon-control-button"
                aria-label="Close songbook"
                onClick={() => navigate('/guest/home')}
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
              <div>
                <p className="empty-state">"{trimmedQuery}" is not available. Would you like to suggest?</p>
                <div className="row-actions top-gap">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigate(`/guest/songbook/suggest/search?keyword=${encodeURIComponent(trimmedQuery)}`)}
                  >
                    Suggest
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty-state">No songs found.</p>
            )
          ) : (
            <div className="queue-list songbook-list guest-songbook-list">
              {songs.map((song) => (
                <article
                 key={song.id}
                 className="queue-item songbook-item"
                 role="button"
                 tabIndex={0}
                 onClick={() => setActiveSongId(song.id)}
                 onKeyDown={(event) => {
                   if (event.key === 'Enter' || event.key === ' ') {
                     event.preventDefault()
                     setActiveSongId(song.id)
                   }
                 }}
                >
                 {song.thumbnailUrl ? (
                   <img className="songbook-thumbnail" src={song.thumbnailUrl} alt={song.title} loading="lazy" />
                 ) : (
                   <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
                 )}
                 <div className="songbook-info">
                   <div className="songbook-item-header">
                     <strong>{song.title}</strong>
                     {song.wasQueuedInSession ? (
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
                     ) : null}
                   </div>
                   <p className="session-meta">
                     {song.artist}
                     {song.duration ? ` · ${song.duration}` : ''}
                   </p>
                 </div>
                </article>
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
            navigate('/guest/home', { replace: true })
          }}
        />
      ) : null}
    </main>
  )
}
