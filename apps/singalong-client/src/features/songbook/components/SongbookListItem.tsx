import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import type { SongbookSong } from '../../../shared/types/client'

type SongbookListItemProps = {
  song: SongbookSong
  onClick: () => void
  badge?: ReactNode
  isMenuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
  onReserve?: () => void
  onEditDetails?: () => void
  detailsLabel?: string
}

export function SongbookListItem({
  song,
  onClick,
  badge,
  isMenuOpen = false,
  onMenuOpenChange,
  onReserve,
  onEditDetails,
  detailsLabel = 'Edit Details',
}: SongbookListItemProps) {
  return (
    <DropdownMenu.Root open={isMenuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenu.Trigger asChild>
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu songbook-context-menu"
          align="end"
          sideOffset={4}
        >
          <DropdownMenu.Item
            className="context-menu-item"
            onSelect={onReserve}
            disabled={onReserve === undefined}
          >
            Reserve
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="context-menu-item"
            onSelect={onEditDetails}
            disabled={onEditDetails === undefined}
          >
            {detailsLabel}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
