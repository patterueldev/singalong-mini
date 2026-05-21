import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchSongDetail } from '../../admin/services/adminService'
import { SkeletonList } from '../components/SkeletonList'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type { SongbookSong } from '../../../shared/types/client'

export function SongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    fetchSongDetail(id)
      .then((s) => {
        setSong(s)
        setIsLoading(false)
      })
      .catch(() => {
        setError('Song not found.')
        setIsLoading(false)
      })
  }, [id])

  const handleVideoLoaded = () => {
    const el = videoRef.current
    if (!el || !el.duration) return
    el.currentTime = el.duration * 0.25
  }

  return (
    <main
      className="modal-backdrop song-detail-backdrop"
      role="presentation"
      onClick={() => navigate('/songbook')}
    >
      <section
        className="modal-card song-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song?.title ?? 'Song details'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Song Details</h2>
            {song !== null ? <p className="subtitle">{song.artist}</p> : null}
          </div>
          <button type="button" className="secondary" onClick={() => navigate('/songbook')}>
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="top-gap">
            <SkeletonList count={1} />
          </div>
        ) : error !== '' ? (
          <p className="error-message top-gap">{error}</p>
        ) : song !== null ? (
          <div className="song-detail-layout">
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

            <div className="song-detail-panels">
              <div className="song-detail-summary-panel">
                <div className="song-detail-header-row">
                  {song.thumbnailUrl ? (
                    <img
                      className="song-detail-thumbnail song-detail-thumbnail--small"
                      src={song.thumbnailUrl}
                      alt={song.title}
                    />
                  ) : (
                    <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                  )}
                  <div className="song-detail-meta">
                    <h1 className="song-detail-title">{song.title}</h1>
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
                    <dt>Source</dt>
                    <dd>{song.sourceUrl ? 'YouTube' : '—'}</dd>
                  </div>
                  <div>
                    <dt>Added by</dt>
                    <dd>{song.addedByUsername ?? '—'}</dd>
                  </div>
                  {song.sourceId ? (
                    <div className="song-detail-grid-wide">
                      <dt>Source ID</dt>
                      <dd>{song.sourceId}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="song-detail-chips top-gap">
                  {song.language ? <span className="chip-badge">{formatLanguageLabel(song.language)}</span> : null}
                  {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                  {song.duration ? <span className="chip-badge">{song.duration}</span> : null}
                  {song.tags.map((t) => (
                    <span key={t} className="chip-badge chip-badge--tag">{t}</span>
                  ))}
                </div>

                {song.sourceUrl ? (
                  <div className="row-actions song-detail-actions">
                    <button
                      type="button"
                      className="youtube-button"
                      onClick={() => window.open(song.sourceUrl!, '_blank', 'noopener,noreferrer')}
                    >
                      View on Youtube
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="song-detail-lyrics-panel">
                <h3>Lyrics</h3>
                <p className="song-detail-lyrics">
                  {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
