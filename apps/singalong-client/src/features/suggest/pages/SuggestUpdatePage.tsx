import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuggestService } from '../hooks/useSuggestService'
import { useSuggestUpdateFlow } from '../hooks/useSuggestUpdateFlow'
import { BlockingHud } from '../components/BlockingHud'
import { ThumbnailPanel } from '../components/ThumbnailPanel'
import { SongDetailsFields } from '../components/SongDetailsFields'
import { MoreDetailsPanel } from '../components/MoreDetailsPanel'
import { DuplicateWarningBanner } from '../components/DuplicateWarningBanner'
import { clearSuggestDraft } from '../../../shared/storage/suggestStorage'
import type { SuggestDraft } from '../../../shared/types/client'

type SuggestUpdatePageProps = {
  nickname: string
  authToken: string
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft) => void
  onDownload: (title: string) => void
  onCancel: () => void
  cancelPath?: string
  downloadPath?: string
  downloadAndReservePath?: string
  downloadButtonLabel?: string
  downloadAndReserveButtonLabel?: string
  showDownloadAndReserve?: boolean
  reserveSessionCode?: string
  reserveTargetOptions?: string[]
  reserveTargetLabel?: string
  defaultReserveTarget?: string
  allowCustomReserveTarget?: boolean
  onDownloadAndReserve?: (title: string) => void
}

export function SuggestUpdatePage({
  nickname,
  authToken,
  draft,
  onDraftChange,
  onDownload,
  onCancel,
  cancelPath = '/songbook',
  downloadPath = '/songbook',
  downloadAndReservePath = '/songbook',
  downloadButtonLabel = 'Download',
  downloadAndReserveButtonLabel = 'Download & Reserve',
  showDownloadAndReserve = false,
  reserveSessionCode,
  reserveTargetOptions = [],
  reserveTargetLabel = 'Reserve as',
  defaultReserveTarget = '',
  allowCustomReserveTarget = false,
  onDownloadAndReserve,
}: SuggestUpdatePageProps) {
  const navigate = useNavigate()
  const { download: suggestDownload } = useSuggestService()
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const flow = useSuggestUpdateFlow({
    draft,
    authToken,
    onDraftChange,
    onError: setErrorMessage,
  })

  const normalizedReserveTargetOptions = Array.from(
    new Set(
      reserveTargetOptions
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
  )
  const initialReserveTarget = defaultReserveTarget.trim()
  const initialReserveSelection =
    initialReserveTarget !== '' && !normalizedReserveTargetOptions.includes(initialReserveTarget)
      ? '__custom__'
      : initialReserveTarget
  const [reserveTargetChoice, setReserveTargetChoice] = useState(initialReserveSelection)
  const [customReserveTarget, setCustomReserveTarget] = useState(
    initialReserveSelection === '__custom__' ? initialReserveTarget : '',
  )

  const confirmExitUpdate = useCallback(
    (onConfirmed: () => void) => {
      const shouldLeave = window.confirm(
        'Leave Song Details? All current changes will be lost.',
      )
      if (!shouldLeave) {
        return
      }
      clearSuggestDraft()
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
                  navigate(cancelPath)
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
            const reservedForNickname =
              shouldReserve && allowCustomReserveTarget
                ? reserveTargetChoice === '__custom__'
                  ? customReserveTarget.trim()
                  : reserveTargetChoice.trim()
                : undefined
            void suggestDownload(
              draft,
              authToken,
              shouldReserve && reserveSessionCode !== undefined
                ? {
                    reserveSessionCode,
                    reservedForNickname:
                      reservedForNickname !== undefined && reservedForNickname !== ''
                        ? reservedForNickname
                        : undefined,
                  }
                : undefined,
            )
              .then(() => {
                if (shouldReserve) {
                  onDownloadAndReserve?.(draft.title)
                } else {
                  onDownload(draft.title)
                }
                clearSuggestDraft()
                setIsSubmitting(false)
                navigate(shouldReserve ? downloadAndReservePath : downloadPath)
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

          {showDownloadAndReserve && (normalizedReserveTargetOptions.length > 0 || allowCustomReserveTarget) ? (
            <div className="form top-gap">
              <label>
                {reserveTargetLabel}
                <select
                  value={reserveTargetChoice}
                  onChange={(event) => setReserveTargetChoice(event.target.value)}
                  disabled={flow.isEnhancing || isSubmitting}
                >
                  {normalizedReserveTargetOptions.map((nicknameOption) => (
                    <option key={nicknameOption} value={nicknameOption}>
                      {nicknameOption}
                    </option>
                  ))}
                  {allowCustomReserveTarget ? <option value="__custom__">Custom nickname…</option> : null}
                </select>
              </label>
              {allowCustomReserveTarget && reserveTargetChoice === '__custom__' ? (
                <label>
                  Custom nickname
                  <input
                    value={customReserveTarget}
                    onChange={(event) => setCustomReserveTarget(event.target.value)}
                    placeholder="guest_nickname"
                    disabled={flow.isEnhancing || isSubmitting}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="row-actions top-gap">
            <button
              type="submit"
              data-action="download"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : downloadButtonLabel}
            </button>
            {showDownloadAndReserve ? (
              <button
                type="submit"
                data-action="download-reserve"
                disabled={
                  isSubmitting ||
                  (allowCustomReserveTarget &&
                    reserveTargetChoice === '__custom__' &&
                    customReserveTarget.trim() === '')
                }
              >
                {isSubmitting ? 'Saving…' : downloadAndReserveButtonLabel}
              </button>
            ) : null}
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
