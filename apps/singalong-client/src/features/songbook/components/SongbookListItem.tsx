import type { ReactNode } from 'react'
import type { SongbookSong } from '../../../shared/types/client'

type SongbookListItemProps = {
  song: SongbookSong
  onClick: () => void
  badge?: ReactNode
  isMenuOpen?: boolean
  onReserve?: () => void
  onEditDetails?: () => void
}

export function SongbookListItem({
  song,
  onClick,
  badge,
  isMenuOpen = false,
  onReserve,
  onEditDetails,
}: SongbookListItemProps) {
  return (
    <div className="songbook-item-shell">
      <article
        className="queue-item songbook-item"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
      >
        {song.thumbnailUrl ? (
          <img
            className="songbook-thumbnail"
            src={song.thumbnailUrl}
            alt={song.title}
            loading="lazy"
          />
        ) : (
          <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
        )}
        <div className="songbook-info">
          <div className="songbook-item-header">
            <strong>{song.title}</strong>
            {badge !== undefined ? badge : null}
          </div>
          <p className="session-meta">
            {song.artist}
            {song.duration ? ` · ${song.duration}` : ''}
          </p>
        </div>
      </article>
      {isMenuOpen ? (
        <div className="context-menu songbook-context-menu" onClick={(event) => event.stopPropagation()} role="menu">
          <button type="button" onClick={onReserve} disabled={onReserve === undefined} role="menuitem">
            Reserve
          </button>
          <button type="button" onClick={onEditDetails} disabled={onEditDetails === undefined} role="menuitem">
            Edit Details
          </button>
        </div>
      ) : null}
    </div>
  )
}
