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
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  className?: string
  extraAction?: ReactNode
}

export function ReservationListItem({
  item,
  onClick,
  showPlayingIcon = false,
  showOutcome = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  className = '',
  extraAction,
}: ReservationListItemProps) {
  const stoppedAt =
    typeof item.playbackPositionSeconds === 'number' && Number.isFinite(item.playbackPositionSeconds)
      ? formatDurationClock(item.playbackPositionSeconds)
      : null
  return (
    <article
      className={`queue-item reservation-item ${className}`.trim()}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      draggable={draggable}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
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
