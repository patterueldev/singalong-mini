import type { DragEvent, ReactNode } from 'react'
import { formatDurationClock } from '../../../shared/lib/format'
import type { SongQueueItem } from '../../../shared/types/client'

type ReservationListItemProps = {
  item: SongQueueItem
  onClick?: () => void
  showPlayingIcon?: boolean
  showOutcome?: boolean
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  className?: string
  extraAction?: ReactNode
  dragHandleLabel?: string
}

export function ReservationListItem({
  item,
  onClick,
  showPlayingIcon = false,
  showOutcome = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  className = '',
  extraAction,
  dragHandleLabel = 'Drag to reorder',
}: ReservationListItemProps) {
  const stoppedAt =
    typeof item.playbackPositionSeconds === 'number' && Number.isFinite(item.playbackPositionSeconds)
      ? formatDurationClock(item.playbackPositionSeconds)
      : null
  return (
    <article
      className={`queue-item reservation-item ${draggable ? 'reservation-item--draggable' : ''} ${className}`.trim()}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
    >
      {draggable ? (
        <button
          type="button"
          className="reservation-drag-handle"
          draggable
          aria-label={dragHandleLabel}
          title={dragHandleLabel}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
            }
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDragStart={(event) => {
            event.stopPropagation()
            onDragStart?.(event)
          }}
          onDragEnd={onDragEnd}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            drag_indicator
          </span>
        </button>
      ) : null}
      {item.thumbnailUrl ? (
        <img className="songbook-thumbnail" src={item.thumbnailUrl} alt={item.title} loading="lazy" />
      ) : (
        <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
      )}
      <div className="songbook-info reservation-info">
        <div className="songbook-item-header">
          <strong>{item.title}</strong>
          {showPlayingIcon ? (
            <span className="material-symbols-outlined reservation-playing-icon" aria-hidden="true">
              graphic_eq
            </span>
          ) : null}
        </div>
        <p className="session-meta">
          {item.artist}
          {item.duration ? ` · ${item.duration}` : ''}
        </p>
        <p className="session-meta reservation-reserved-by">
          Reserved by {item.reservedByUsername ?? 'unknown'}
        </p>
        {showOutcome && (item.status === 'finished' || item.status === 'skipped') ? (
          <p className="session-meta reservation-outcome">
            <span className={`reservation-outcome-badge ${item.status}`}>
              {item.status === 'finished' ? 'Finished' : 'Skipped'}
            </span>
            {stoppedAt ? <span className="reservation-outcome-time">Stopped at {stoppedAt}</span> : null}
          </p>
        ) : null}
        {extraAction !== undefined ? <div className="reservation-extra-action">{extraAction}</div> : null}
      </div>
    </article>
  )
}
