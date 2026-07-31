import type { SuggestDuplicateMatch } from '../../../shared/types/client'

type DuplicateWarningBannerProps = {
  matches: SuggestDuplicateMatch[]
  onDismiss: () => void
}

export function DuplicateWarningBanner({ matches, onDismiss }: DuplicateWarningBannerProps) {
  if (matches.length === 0) {
    return null
  }

  const [primary, ...rest] = matches

  return (
    <div className="warning-banner top-gap" role="alert">
      <span>
        This looks similar to {primary.artist ? `"${primary.title}" by ${primary.artist}` : `"${primary.title}"`}{' '}
        already in the songbook.
        {rest.length > 0 ? ` (+${rest.length} more similar)` : ''}
      </span>
      <button
        type="button"
        className="warning-banner-dismiss"
        aria-label="Dismiss duplicate warning"
        onClick={onDismiss}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  )
}
