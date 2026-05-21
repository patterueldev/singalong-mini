import { formatDownloadStatus } from '../../../shared/lib/format'
import type { DownloadProgressItem } from '../../../shared/types/client'

type DownloadProgressModalProps = {
  isOpen: boolean
  status: string
  items: DownloadProgressItem[]
  retryingSongIds: string[]
  onClose: () => void
  onRetryDownload: (songId: string) => void
}

export function DownloadProgressModal({
  isOpen,
  status,
  items,
  retryingSongIds,
  onClose,
  onRetryDownload,
}: DownloadProgressModalProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        className="modal-card downloads-modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <h2>Download Progress</h2>
            <p className="subtitle">Status: {status}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="downloads-modal-list top-gap">
          {items.length === 0 ? (
            <p className="empty-state">No active downloads.</p>
          ) : (
            items.map((item) => {
              const isRetrying = retryingSongIds.includes(item.songId)
              const progressValue =
                item.progressPct !== null ? Math.max(0, Math.min(100, item.progressPct)) : 0
              const statusText =
                item.status === 'error'
                  ? item.errorMessage ?? 'Download failed'
                  : item.status === 'pending'
                    ? 'Waiting in queue'
                    : 'Downloading video'

              return (
                <article key={item.songId} className="downloads-progress-item">
                  {item.sourceThumbnail ? (
                    <img
                      className="downloads-progress-thumb"
                      src={item.sourceThumbnail}
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="downloads-progress-thumb downloads-progress-thumb--placeholder" />
                  )}
                  <div className="downloads-progress-content">
                    <strong>{item.title}</strong>
                    <p className="session-meta">
                      {item.artist}
                      {' · '}
                      {item.duration ?? '--:--'}
                    </p>
                    <p className="session-meta">{item.addedByUsername ?? '—'}</p>
                    <div className="downloads-progress-row">
                      <div className="downloads-progress-bar-group">
                        <progress
                          className="downloads-progress-bar"
                          max={100}
                          value={progressValue}
                        />
                        <span className="downloads-progress-pct">{progressValue}%</span>
                      </div>
                      <span className={`badge download-status-badge ${item.status}`}>
                        {formatDownloadStatus(item.status)}
                      </span>
                    </div>
                    <p className="session-meta">{statusText}</p>
                    {item.status === 'error' ? (
                      <div className="downloads-actions">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => onRetryDownload(item.songId)}
                          disabled={isRetrying}
                        >
                          {isRetrying ? 'Retrying…' : 'Retry'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
