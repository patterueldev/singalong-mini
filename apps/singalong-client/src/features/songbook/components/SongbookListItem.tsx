import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SongbookSong } from '../../../shared/types/client'

type SongbookListItemProps = {
  song: SongbookSong
  onClick: () => void
  badge?: ReactNode
  isMenuOpen?: boolean
  onReserve?: () => void
  onEditDetails?: () => void
}

type MenuPosition = { top: number; right: number }

export function SongbookListItem({
  song,
  onClick,
  badge,
  isMenuOpen = false,
  onReserve,
  onEditDetails,
}: SongbookListItemProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)

  // Compute fixed position from the item's bounding rect when the menu opens.
  // Rendering via portal ensures the menu floats above any scroll container.
  useEffect(() => {
    if (!isMenuOpen || shellRef.current === null) {
      setMenuPos(null)
      return
    }
    const rect = shellRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right + 8,
    })
  }, [isMenuOpen])

  return (
    <div ref={shellRef} className="songbook-item-shell">
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
      {isMenuOpen && menuPos !== null
        ? createPortal(
            <div
              className="context-menu songbook-context-menu"
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
              onClick={(event) => event.stopPropagation()}
              role="menu"
            >
              <button type="button" onClick={onReserve} disabled={onReserve === undefined} role="menuitem">
                Reserve
              </button>
              <button type="button" onClick={onEditDetails} disabled={onEditDetails === undefined} role="menuitem">
                Edit Details
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
