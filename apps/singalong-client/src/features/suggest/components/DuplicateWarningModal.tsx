import type { SuggestDraft, SuggestDuplicateMatch } from '../../../shared/types/client'

type DuplicateWarningModalProps = {
  draft: SuggestDraft
  matches: SuggestDuplicateMatch[]
  onReserveExisting: (songId: string) => void
  onAddAnyway: () => void
  onCancel: () => void
}

function describeStatus(match: SuggestDuplicateMatch): string | null {
  if (match.is_archived) {
    return 'Archived'
  }
  if (match.status === 'published') {
    return null
  }
  if (match.status === 'downloading') {
    return 'Currently downloading'
  }
  if (match.status === 'error') {
    return 'Previous download failed'
  }
  return `Status: ${match.status}`
}

export function DuplicateWarningModal({
  draft,
  matches,
  onReserveExisting,
  onAddAnyway,
  onCancel,
}: DuplicateWarningModalProps) {
  const primaryMatches = matches.filter((match) => match.confidence === 'exact' || match.confidence === 'high')
  const otherMatches = matches.filter((match) => match.confidence === 'possible')

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card context-menu-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${draft.title} may already be in the songbook`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Possible duplicate</h2>
            <p className="subtitle">{draft.title}</p>
          </div>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <p className="modal-description top-gap">
          This looks like it might already be in the songbook. Reserve the existing song, or add this video anyway
          as a separate entry.
        </p>

        <div className="duplicate-match-list top-gap">
          {primaryMatches.map((match) => {
            const statusLabel = describeStatus(match)
            return (
              <div className="duplicate-match-row" key={match.song_id}>
                {match.thumbnail_url ? (
                  <img className="songbook-thumbnail" src={match.thumbnail_url} alt={match.title} />
                ) : (
                  <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
                )}
                <div className="songbook-info">
                  <strong>{match.title}</strong>
                  <p className="session-meta">{match.artist}</p>
                  {statusLabel !== null ? <p className="duplicate-match-status">{statusLabel}</p> : null}
                </div>
                <button type="button" onClick={() => onReserveExisting(match.song_id)}>
                  Reserve this one
                </button>
              </div>
            )
          })}
        </div>

        {otherMatches.length > 0 ? (
          <p className="field-help top-gap">
            Also similar: {otherMatches.map((match) => `${match.title} — ${match.artist}`).join(', ')}
          </p>
        ) : null}

        <div className="row-actions modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="secondary" onClick={onAddAnyway}>
            Add anyway
          </button>
        </div>
      </div>
    </div>
  )
}
