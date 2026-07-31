import { useCallback, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useGuestSession } from '../hooks/useGuestSession'
import { useSuggestService } from '../../suggest/hooks/useSuggestService'
import { useSuggestUpdateFlow } from '../../suggest/hooks/useSuggestUpdateFlow'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import { ThumbnailPanel } from '../../suggest/components/ThumbnailPanel'
import { SongDetailsFields } from '../../suggest/components/SongDetailsFields'
import { MoreDetailsPanel } from '../../suggest/components/MoreDetailsPanel'
import { DuplicateWarningBanner } from '../../suggest/components/DuplicateWarningBanner'
import type { SuggestDraft } from '../../../shared/types/client'
import { isValidSessionCode } from '../../../shared/lib/validation'

const BACK_PATH = '/songs'
const RESERVE_PATH = '/home'

function useGuestSuggestAccess() {
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  if (!hasGuestSession || guestAuth === null || !isValidSessionCode(sessionCode)) {
    return null
  }
  return { guestAuth, sessionCode }
}

type GuestSuggestUpdatePageProps = {
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft) => void
  onDiscardDraft: () => void
}

export function GuestSuggestUpdatePage({ draft, onDraftChange, onDiscardDraft }: GuestSuggestUpdatePageProps) {
  const access = useGuestSuggestAccess()

  if (access === null) {
    return <Navigate to="/join" replace />
  }

  return (
    <GuestSuggestUpdatePageContent
      authToken={access.guestAuth.accessToken}
      sessionCode={access.sessionCode}
      draft={draft}
      onDraftChange={onDraftChange}
      onDiscardDraft={onDiscardDraft}
    />
  )
}

type GuestSuggestUpdatePageContentProps = {
  authToken: string
  sessionCode: string
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft) => void
  onDiscardDraft: () => void
}

function GuestSuggestUpdatePageContent({
  authToken,
  sessionCode,
  draft,
  onDraftChange,
  onDiscardDraft,
}: GuestSuggestUpdatePageContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const backPath = (location.state as { returnTo?: string } | null)?.returnTo ?? BACK_PATH
  const { download: suggestDownload } = useSuggestService()
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const flow = useSuggestUpdateFlow({
    draft,
    authToken,
    onDraftChange: (nextDraft) => onDraftChange(nextDraft),
    onError: setErrorMessage,
  })

  const confirmExitUpdate = useCallback(
    (onConfirmed: () => void) => {
      const shouldLeave = window.confirm('Leave Song Details? All current changes will be lost.')
      if (!shouldLeave) {
        return
      }
      onDiscardDraft()
      onConfirmed()
    },
    [onDiscardDraft],
  )

  return (
    <main className="app-shell">
      <section className="card suggest-update-card">
        <div className="card-header">
          <div className="card-header-lead">
            <button
              type="button"
              className="secondary icon-button"
              aria-label="Back to songbook"
              disabled={flow.isEnhancing || isSubmitting}
              onClick={() => {
                confirmExitUpdate(() => {
                  navigate(backPath)
                })
              }}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                arrow_back
              </span>
            </button>
            <h1>Song Details</h1>
          </div>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            setErrorMessage('')
            setIsSubmitting(true)
            void suggestDownload(draft, authToken, { reserveSessionCode: sessionCode })
              .then(() => {
                onDiscardDraft()
                setIsSubmitting(false)
                navigate(RESERVE_PATH)
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Failed to reserve song'
                setErrorMessage(message)
                setIsSubmitting(false)
              })
          }}
        >
          <div className="suggest-update-layout">
            <ThumbnailPanel
              previewUrl={flow.previewUrl}
              title={draft.title}
              contextMenu={flow.contextMenu}
              onOpenContextMenu={flow.openThumbnailContextMenu}
              onCloseContextMenu={flow.closeContextMenu}
              thumbnailFileInputRef={flow.thumbnailFileInputRef}
              onUpload={flow.handleThumbnailUpload}
              onReset={flow.resetThumbnail}
            />

            <SongDetailsFields draft={draft} onUpdate={flow.updateDraft} />
          </div>

          {draft.isLikelySong === false && !flow.isContentWarningDismissed ? (
            <div className="warning-banner top-gap" role="alert">
              <span>
                This doesn't look like a karaoke song — double-check before downloading.
                {draft.contentNotice ? ` ${draft.contentNotice}` : ''}
              </span>
              <button
                type="button"
                className="warning-banner-dismiss"
                aria-label="Dismiss warning"
                onClick={flow.dismissContentWarning}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
          ) : null}

          {!flow.isDuplicateWarningDismissed ? (
            <DuplicateWarningBanner
              matches={draft.possibleDuplicates ?? []}
              onDismiss={flow.dismissDuplicateWarning}
            />
          ) : null}

          <MoreDetailsPanel
            isOpen={flow.isDetailsOpen}
            onToggle={() => flow.setIsDetailsOpen((open) => !open)}
            draft={draft}
            onUpdate={flow.updateDraft}
            isEnhancing={flow.isEnhancing}
            isSubmitting={isSubmitting}
            enhanceMessage={flow.enhanceMessage}
            onEnhance={flow.handleEnhance}
            onPreviewOnYoutube={flow.previewOnYoutube}
            onGenreInputChange={flow.setGenreInput}
            metadataSuggestions={flow.metadataSuggestions}
            tagInput={flow.tagInput}
            onTagInputChange={flow.setTagInput}
            onCommitTags={flow.commitTags}
            onOpenLyricsSearch={flow.openLyricsSearch}
          />

          <div className="row-actions top-gap">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Reserving…' : 'Reserve'}
            </button>
          </div>
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
        </form>
        {flow.isEnhancing || isSubmitting ? (
          <BlockingHud message={flow.isEnhancing ? 'Enhancing song details...' : 'Processing Song…'} />
        ) : null}
      </section>
    </main>
  )
}
