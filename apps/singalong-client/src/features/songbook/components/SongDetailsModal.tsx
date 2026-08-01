import { useState } from 'react'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type { SongbookSong } from '../../../shared/types/client'

type SongDetailsModalProps = {
  isOpen: boolean
  song: SongbookSong | null
  isLoading?: boolean
  errorMessage?: string
  onClose: () => void
  reserveLabel?: string
  onReserve?: () => void
  reserveDisabled?: boolean
  isReserving?: boolean
  editLabel?: string
  onEditDetails?: () => void
  editDisabled?: boolean
  shareUrl?: string
}

export function SongDetailsModal({
  isOpen,
  song,
  isLoading = false,
  errorMessage = '',
  onClose,
  reserveLabel = 'Reserve',
  onReserve,
  reserveDisabled = false,
  isReserving = false,
  editLabel = 'Edit Details',
  onEditDetails,
  editDisabled = false,
  shareUrl,
}: SongDetailsModalProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle')

  if (!isOpen) {
    return null
  }

  const handleShare = () => {
    if (!shareUrl) return
    void navigator.clipboard
      .writeText(shareUrl)
      .then(() => setShareState('copied'))
      .catch(() => setShareState('error'))
      .finally(() => {
        window.setTimeout(() => setShareState('idle'), 2000)
      })
  }

  return (
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal unified-song-details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song?.title ?? 'Song details'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Song Details</h2>
          <button type="button" className="icon-control-button" aria-label="Close song details" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        {onReserve || onEditDetails ? (
          <div className="row-actions top-gap">
            {onReserve ? (
              <button type="button" onClick={onReserve} disabled={reserveDisabled || isLoading || song === null}>
                {isReserving ? 'Reserving…' : reserveLabel}
              </button>
            ) : null}
            {onEditDetails ? (
              <button type="button" className="secondary" onClick={onEditDetails} disabled={editDisabled || isLoading || song === null}>
                {editLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <p className="empty-state top-gap">Loading song details…</p>
        ) : errorMessage !== '' ? (
          <p className="error-message top-gap">{errorMessage}</p>
        ) : song !== null ? (
          <div className="unified-song-details-layout top-gap">
            <section className="unified-song-details-left">
              <div className="unified-song-details-thumbnail-panel">
                {song.thumbnailUrl ? (
                  <img className="song-detail-thumbnail song-detail-thumbnail--full" src={song.thumbnailUrl} alt={song.title} />
                ) : (
                  <div className="song-detail-thumbnail song-detail-thumbnail--full song-detail-thumbnail--placeholder" />
                )}
              </div>

              <h3 className="song-detail-title">{song.title}</h3>
              <p className="subtitle">{song.artist}</p>

              <dl className="song-detail-grid">
                <div>
                  <dt>Language</dt>
                  <dd>{formatLanguageLabel(song.language)}</dd>
                </div>
                <div>
                  <dt>Genre</dt>
                  <dd>{song.genre ?? '—'}</dd>
                </div>
                <div>
                  <dt>Has Lyrics</dt>
                  <dd>{song.videoHasLyrics ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt>Is Off Vocal</dt>
                  <dd>{song.isOffVocal ? 'Yes' : 'No'}</dd>
                </div>
                <div className="song-detail-grid-wide">
                  <dt>Duration</dt>
                  <dd>{song.duration || '—'}</dd>
                </div>
              </dl>

              <div className="song-detail-tags-section">
                <h3>Tags</h3>
                <div className="song-detail-chips top-gap">
                  {song.tags.length === 0 ? (
                    <span className="subtitle">No tags</span>
                  ) : (
                    song.tags.map((tag) => (
                      <span key={tag} className="chip-badge chip-badge--tag">
                        {tag}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="unified-song-details-spacer" />
            </section>

            <section className="unified-song-details-right">
              <div className="unified-song-details-video-panel">
                {song.videoFile ? (
                  <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
                ) : (
                  <p className="empty-state">Video not available.</p>
                )}
              </div>

              {song.sourceUrl || shareUrl ? (
                <div className="row-actions song-detail-actions">
                  {song.sourceUrl ? (
                    <button
                      type="button"
                      className="youtube-button"
                      onClick={() => window.open(song.sourceUrl!, '_blank', 'noopener,noreferrer')}
                    >
                      View on Youtube
                    </button>
                  ) : null}
                  {shareUrl ? (
                    <button type="button" className="secondary" onClick={handleShare}>
                      {shareState === 'copied' ? 'Link copied!' : shareState === 'error' ? 'Copy failed' : 'Copy Link'}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="song-detail-lyrics-section">
                <h3>Lyrics</h3>
                <p className="song-detail-lyrics top-gap">
                  {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
                </p>
              </div>

              <div className="unified-song-details-spacer" />
            </section>
          </div>
        ) : null}
      </section>
    </div>
  )
}
