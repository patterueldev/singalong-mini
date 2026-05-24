import type { ReactNode } from 'react'
import type { SongbookSong } from '../../../shared/types/client'

type SongbookListItemProps = {
  song: SongbookSong
  onClick: () => void
  badge?: ReactNode
}

export function SongbookListItem({
  song,
  onClick,
  badge,
}: SongbookListItemProps) {
  return (
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
        <img className="songbook-thumbnail" src={song.thumbnailUrl} alt={song.title} loading="lazy" />
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
  )
}
