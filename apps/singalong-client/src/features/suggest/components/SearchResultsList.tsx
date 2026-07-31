import { forwardRef, useState } from 'react'
import type { PointerEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { SkeletonList } from '../../songbook/components/SkeletonList'
import type { SuggestResult } from '../../../shared/types/client'

type SearchResultRowMenu = {
  primaryLabel?: string
  onReserve: () => void
  onPreview: () => void
  onEnhanceDetails?: () => void
}

type SearchResultsListProps = {
  results: SuggestResult[]
  isSearching: boolean
  hidden?: boolean
  onSelectResult: (result: SuggestResult) => void
  menu?: (result: SuggestResult) => SearchResultRowMenu
}

type SearchResultRowProps = {
  result: SuggestResult
  onClick?: () => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
}

const SearchResultRow = forwardRef<HTMLButtonElement, SearchResultRowProps>(
  ({ result, onClick, onPointerDown }, ref) => (
    <button ref={ref} type="button" className="search-result-row" onClick={onClick} onPointerDown={onPointerDown}>
      <img className="search-result-thumb" src={result.thumbnailUrl} alt={result.title} />
      <div className="search-result-content">
        <strong className="search-result-title" title={result.title}>
          {result.title}
        </strong>
        <p className="search-result-meta">
          {result.duration} - {result.channelName}
        </p>
        {result.existsInSongbook === true ? (
          <p className="search-result-exists">✔ Already in songbook</p>
        ) : null}
      </div>
    </button>
  ),
)
SearchResultRow.displayName = 'SearchResultRow'

function SearchResultMenuRow({ result, menu }: { result: SuggestResult; menu: (result: SuggestResult) => SearchResultRowMenu }) {
  const [menuAlign, setMenuAlign] = useState<'start' | 'end'>('start')
  const actions = menu(result)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <SearchResultRow
          result={result}
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
          <DropdownMenu.Item className="context-menu-item" onSelect={actions.onReserve}>
            {actions.primaryLabel ?? 'Reserve'}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="context-menu-item" onSelect={actions.onPreview}>
            Preview
          </DropdownMenu.Item>
          {actions.onEnhanceDetails ? (
            <DropdownMenu.Item className="context-menu-item" onSelect={actions.onEnhanceDetails}>
              Enhance Details
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function SearchResultsList({
  results,
  isSearching,
  hidden = false,
  onSelectResult,
  menu,
}: SearchResultsListProps) {
  if (hidden) {
    return null
  }

  if (isSearching) {
    return <SkeletonList count={5} />
  }

  if (results.length === 0) {
    return null
  }

  return (
    <>
      {results.map((result) =>
        menu === undefined ? (
          <SearchResultRow key={result.id} result={result} onClick={() => onSelectResult(result)} />
        ) : (
          <SearchResultMenuRow key={result.id} result={result} menu={menu} />
        ),
      )}
    </>
  )
}
