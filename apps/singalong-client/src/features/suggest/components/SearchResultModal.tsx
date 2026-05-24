import type { SuggestResult } from '../../../shared/types/client'

type SearchResultModalProps = {
  result: SuggestResult
  onClose: () => void
  onIdentify: (result: SuggestResult) => void
}

export function SearchResultModal({ result, onClose, onIdentify }: SearchResultModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${result.title} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{result.title}</h2>
            <p className="subtitle">
              {result.duration} · {result.channelName}
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-player">
            {result.youtubeId !== '' ? (
              <iframe
                title={result.title}
                src={`https://www.youtube.com/embed/${result.youtubeId}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <p className="empty-state">Embedded player unavailable for this result.</p>
            )}
          </div>

          <div className="modal-details">
            <p className="session-meta">
              <strong>Channel:</strong> {result.channelName}
            </p>
            <p className="session-meta">
              <strong>Source:</strong>{' '}
              <a href={result.sourceUrl} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
            </p>
            {result.channelUrl !== '' ? (
              <p className="session-meta">
                <strong>Channel URL:</strong>{' '}
                <a href={result.channelUrl} target="_blank" rel="noreferrer">
                  Open channel
                </a>
              </p>
            ) : null}
            {result.uploadedAt !== '' ? (
              <p className="session-meta">
                <strong>Uploaded:</strong> {result.uploadedAt}
              </p>
            ) : null}
            {result.viewCount !== null ? (
              <p className="session-meta">
                <strong>Views:</strong> {result.viewCount.toLocaleString()}
              </p>
            ) : null}
            <p className="session-meta">
              <strong>Songbook status:</strong>{' '}
              {result.existsInSongbook === true
                ? 'Already in songbook'
                : result.existsInSongbook === false
                  ? 'Not in songbook yet'
                  : 'Pending'}
            </p>
            {result.description !== '' ? (
              <p className="modal-description">{result.description}</p>
            ) : null}
          </div>
        </div>

        <div className="row-actions modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onIdentify(result)}
          >
            Identify
          </button>
          <button
            type="button"
            className="youtube-button"
            onClick={() => window.open(result.sourceUrl, '_blank', 'noopener,noreferrer')}
          >
            View on Youtube
          </button>
        </div>
      </div>
    </div>
  )
}
