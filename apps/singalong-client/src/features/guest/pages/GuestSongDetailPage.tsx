import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { adminService } from '../../admin/services/adminService'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestReserveSong } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type { SongbookSong } from '../../../shared/types/client'

export function GuestSongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isReserving, setIsReserving] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!id || !hasGuestSession || !isValidSessionCode(sessionCode)) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    void adminService
      .fetchSongDetail(id, undefined, sessionCode)
      .then((payload) => {
        if (!cancelled) {
          setSong(payload)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage('Song not found.')
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
  }, [hasGuestSession, id, sessionCode])

  const handleVideoLoaded = () => {
    const el = videoRef.current
    if (!el || !el.duration) return
    el.currentTime = el.duration * 0.25
  }

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/guest/join" replace />
  }

  const handleReserve = async () => {
    if (!id) {
      return
    }
    setIsReserving(true)
    setErrorMessage('')
    try {
      await guestReserveSong(sessionCode, id, guestAuth.accessToken)
      navigate('/guest/home', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reserve song')
    } finally {
      setIsReserving(false)
    }
  }

  return (
    <main className="app-shell guest-shell">
      <section className="card guest-home-card">
        <div className="card-header">
          <div>
            <h1>Song Details</h1>
            <p className="subtitle">
              Session <strong>{sessionCode}</strong> · {guestAuth.nickname}
            </p>
          </div>
          <button type="button" className="secondary" onClick={() => navigate('/guest/songbook')}>
            Back
          </button>
        </div>

        {isLoading ? (
          <p className="empty-state top-gap">Loading song details…</p>
        ) : errorMessage !== '' ? (
          <p className="error-message top-gap">{errorMessage}</p>
        ) : song !== null ? (
          <div className="song-detail-layout top-gap">
            <div className="song-detail-video-panel">
              {song.videoFile ? (
                <video
                  ref={videoRef}
                  controls
                  className="song-detail-video"
                  onLoadedMetadata={handleVideoLoaded}
                  src={`/media/songs/${song.videoFile}`}
                />
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
                <button type="button" className="secondary" onClick={() => navigate('/guest/songbook')}>
                  Back to songbook
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
    </main>
  )
}
