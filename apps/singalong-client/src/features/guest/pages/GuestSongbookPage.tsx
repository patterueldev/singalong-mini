import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { SongbookListItem } from '../../songbook/components/SongbookListItem'
import { adminService } from '../../admin/services/adminService'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestReserveSong } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type { SongbookSong } from '../../../shared/types/client'

type GuestSongDetailModalProps = {
  songId: string
  sessionCode: string
  nickname: string
  authToken: string
  onClose: () => void
  onReserved: () => void
}

function GuestSongDetailModal({
  songId,
  sessionCode,
  nickname,
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
        <div className="modal-header">
          <div>
            <h2>Song Details</h2>
            <p className="subtitle">
              Session <strong>{sessionCode}</strong> · {nickname}
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

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
                <div>
                  <dt>Duration</dt>
                  <dd>{song.duration}</dd>
                </div>
                <div>
                  <dt>Added by</dt>
                  <dd>{song.addedByUsername ?? '—'}</dd>
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

              <div className="row-actions song-detail-actions top-gap">
                <button type="button" className="secondary" onClick={onClose}>
                  Back
                </button>
                <button type="button" disabled={isReserving} onClick={() => void handleReserve()}>
                  {isReserving ? 'Reserving…' : 'Reserve'}
                </button>
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

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/guest/join" replace />
  }

  return (
    <main className="app-shell guest-fullscreen-shell">
      <section className="card guest-fullscreen-card guest-songbook-screen">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            <p className="subtitle">
              Session <strong>{sessionCode}</strong> · {guestAuth.nickname}
            </p>
          </div>
          <button type="button" className="secondary icon-button" aria-label="Back to guest home" onClick={() => navigate('/guest/home')}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
        </div>

        {message !== '' ? <p className="success-message top-gap">{message}</p> : null}
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}

        <div className="form top-gap">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songbook" />
        </div>

        <div className="top-gap guest-scroll-content">
          {isLoading ? (
            <p className="empty-state">Loading songbook…</p>
          ) : activeSongbookCount === 0 ? (
            <p className="empty-state">No songs found.</p>
          ) : (
            <div className="queue-list songbook-list guest-songbook-list">
              {songs.map((song) => (
                <article key={song.id} className="songbook-guest-item">
                  <SongbookListItem song={song} onClick={() => setActiveSongId(song.id)} />
                  <div className="row-actions top-gap songbook-guest-actions">
                    <button type="button" className="secondary small" onClick={() => setActiveSongId(song.id)}>
                      Details
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

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
      </section>

      {activeSongId !== null ? (
        <GuestSongDetailModal
          songId={activeSongId}
          sessionCode={sessionCode}
          nickname={guestAuth.nickname}
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
