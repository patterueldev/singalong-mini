import { forwardRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { SongbookSong } from '../../../shared/types/client'

type SongbookListItemMenu = {
  onReserve: () => void
  onViewDetails: () => void
}

type SongbookListItemProps = {
  song: SongbookSong
  onClick: () => void
  badge?: ReactNode
  menu?: SongbookListItemMenu
}

type SongbookListItemRowProps = {
  song: SongbookSong
  badge?: ReactNode
  onClick?: () => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
}

const SongbookListItemRow = forwardRef<HTMLElement, SongbookListItemRowProps>(
  ({ song, badge, onClick, onPointerDown }, ref) => (
    <article
      ref={ref}
      className="queue-item songbook-item"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
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
  ),
)
SongbookListItemRow.displayName = 'SongbookListItemRow'

export function SongbookListItem({ song, onClick, badge, menu }: SongbookListItemProps) {
  const [menuAlign, setMenuAlign] = useState<'start' | 'end'>('start')

  if (menu === undefined) {
    return <SongbookListItemRow song={song} badge={badge} onClick={onClick} />
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <SongbookListItemRow
          song={song}
          badge={badge}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const tapX = event.clientX - rect.left
            setMenuAlign(tapX > rect.width / 2 ? 'end' : 'start')
          }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu songbook-context-menu"
          side="bottom"
          align={menuAlign}
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
        >
          <DropdownMenu.Item className="context-menu-item" onSelect={menu.onReserve}>
            Reserve
          </DropdownMenu.Item>
          <DropdownMenu.Item className="context-menu-item" onSelect={menu.onViewDetails}>
            Details
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
