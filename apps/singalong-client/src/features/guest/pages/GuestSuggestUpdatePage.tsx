import { useCallback, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGuestSession } from '../hooks/useGuestSession'
import { useSuggestService } from '../../suggest/hooks/useSuggestService'
import { useSuggestUpdateFlow } from '../../suggest/hooks/useSuggestUpdateFlow'
import { BlockingHud } from '../../suggest/components/BlockingHud'
import { ThumbnailPanel } from '../../suggest/components/ThumbnailPanel'
import { SongDetailsFields } from '../../suggest/components/SongDetailsFields'
import { MoreDetailsPanel } from '../../suggest/components/MoreDetailsPanel'
import type { SuggestDraft } from '../../../shared/types/client'
import { isValidSessionCode } from '../../../shared/lib/validation'

const CANCEL_PATH = '/songs'
const DOWNLOAD_PATH = '/home'
const DOWNLOAD_AND_RESERVE_PATH = '/home'

function useGuestSuggestAccess() {
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  if (!hasGuestSession || guestAuth === null || !isValidSessionCode(sessionCode)) {
    return null
  }
  return { guestAuth, sessionCode }
}

type GuestSuggestUpdatePageProps = {
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft | null) => void
  onCancel: () => void
}

export function GuestSuggestUpdatePage({ draft, onDraftChange, onCancel }: GuestSuggestUpdatePageProps) {
  const access = useGuestSuggestAccess()

  if (access === null) {
    return <Navigate to="/join" replace />
  }

  return (
    <GuestSuggestUpdatePageContent
      nickname={access.guestAuth.nickname}
      authToken={access.guestAuth.accessToken}
      sessionCode={access.sessionCode}
      draft={draft}
      onDraftChange={onDraftChange}
      onCancel={onCancel}
    />
  )
}

type GuestSuggestUpdatePageContentProps = {
  nickname: string
  authToken: string
  sessionCode: string
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft | null) => void
  onCancel: () => void
}

function GuestSuggestUpdatePageContent({
  nickname,
  authToken,
  sessionCode,
  draft,
  onDraftChange,
  onCancel,
}: GuestSuggestUpdatePageContentProps) {
  const navigate = useNavigate()
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
      onCancel()
      onConfirmed()
    },
    [onCancel],
  )

  return (
    <main className="app-shell">
      <section className="card suggest-update-card">
        <div className="card-header">
          <div>
            <h1>Suggest · Update Details</h1>
            <p className="subtitle">
              Signed in as <strong>{nickname}</strong>
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              disabled={flow.isEnhancing || isSubmitting}
              onClick={() => {
                confirmExitUpdate(() => {
                  navigate(CANCEL_PATH)
                })
              }}
            >
              Cancel
            </button>
          </div>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            const submitter = (event.nativeEvent as SubmitEvent).submitter as
              | HTMLButtonElement
              | null
            const action = submitter?.dataset.action
            if (action !== 'download' && action !== 'download-reserve') {
              return
            }
            setErrorMessage('')
            setIsSubmitting(true)
            const shouldReserve = action === 'download-reserve'
            void suggestDownload(
              draft,
              authToken,
              shouldReserve ? { reserveSessionCode: sessionCode } : undefined,
            )
              .then(() => {
                onDraftChange(null)
                setIsSubmitting(false)
                navigate(shouldReserve ? DOWNLOAD_AND_RESERVE_PATH : DOWNLOAD_PATH)
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Download failed'
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
            <button type="submit" data-action="download" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Download & Back to Home'}
            </button>
            <button type="submit" data-action="download-reserve" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Download & Reserve'}
            </button>
          </div>
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
        </form>
        {flow.isEnhancing || isSubmitting ? (
          <BlockingHud message={flow.isEnhancing ? 'Enhancing song details...' : 'Saving song...'} />
        ) : null}
      </section>
    </main>
  )
}
