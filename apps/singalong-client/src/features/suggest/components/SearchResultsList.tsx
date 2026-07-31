import { SkeletonList } from '../../songbook/components/SkeletonList'
import type { SuggestResult } from '../../../shared/types/client'

type SearchResultsListProps = {
  results: SuggestResult[]
  isSearching: boolean
  hidden?: boolean
  onSelectResult: (result: SuggestResult) => void
}

export function SearchResultsList({ results, isSearching, hidden = false, onSelectResult }: SearchResultsListProps) {
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
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          className="search-result-row"
          onClick={() => onSelectResult(result)}
        >
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
      ))}
    </>
  )
}
