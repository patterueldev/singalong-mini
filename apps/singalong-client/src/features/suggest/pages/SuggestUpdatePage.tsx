import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuggestService } from '../hooks/useSuggestService'
import { ChipField } from '../components/ChipField'
import { BlockingHud } from '../components/BlockingHud'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { LANGUAGE_OPTIONS } from '../../../shared/config/client'
import { readFileAsDataUrl } from '../../../shared/lib/files'
import { normalizeLanguageCodeForUi } from '../../../shared/lib/format'
import {
  normalizeTagList,
  splitChipInput,
} from '../../../shared/lib/suggest'
import { clearSuggestDraft } from '../../../shared/storage/suggestStorage'
import type {
  SuggestDraft,
  SuggestMetadataSuggestionsResponse,
} from '../../../shared/types/client'

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
  const {
    download: suggestDownload,
    enhance: suggestEnhance,
    metadataSuggestions: suggestMetadataSuggestions,
  } = useSuggestService()
  const [originalDraft] = useState(draft)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceMessage, setEnhanceMessage] = useState('')
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [genreInput, setGenreInput] = useState(draft.genre)
  const [tagInput, setTagInput] = useState('')
  const [metadataSuggestions, setMetadataSuggestions] = useState<SuggestMetadataSuggestionsResponse>({
    genres: [],
    tags: [],
  })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
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
  const thumbnailFileInputRef = useRef<HTMLInputElement>(null)
  const previewUrl =
    draft.source_thumbnail_data_url !== '' ? draft.source_thumbnail_data_url : draft.source_thumbnail

  const openThumbnailContextMenu = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.top + rect.height })
  }, [])

  const updateDraft = useCallback(
    (patch: Partial<SuggestDraft>) => {
      const nextDraft = { ...draft, ...patch }
      onDraftChange({
        ...nextDraft,
        genre: nextDraft.genre.trim(),
        tags: normalizeTagList(nextDraft.tags),
      })
    },
    [draft, onDraftChange],
  )

  const commitTags = useCallback(() => {
    const nextValues = splitChipInput(tagInput, (entry) => entry.trim().toLowerCase())
    if (nextValues.length === 0) {
      return
    }

    updateDraft({ tags: normalizeTagList([...draft.tags, ...nextValues]) })
    setTagInput('')
  }, [draft.tags, tagInput, updateDraft])

  useEffect(() => {
    let isStale = false
    void suggestMetadataSuggestions('', authToken)
      .then((payload) => {
        if (isStale) {
          return
        }
        setMetadataSuggestions({
          genres: payload.genres,
          tags: normalizeTagList(payload.tags),
        })
      })
      .catch(() => {
        if (!isStale) {
          setMetadataSuggestions({ genres: [], tags: [] })
        }
      })
    return () => {
      isStale = true
    }
  }, [authToken])

  useEffect(() => {
    const keyword = genreInput.trim()
    if (keyword === '') {
      return
    }

    let isStale = false
    const timeoutId = window.setTimeout(() => {
      void suggestMetadataSuggestions(keyword, authToken)
        .then((payload) => {
          if (isStale) {
            return
          }
          setMetadataSuggestions((current) => ({
            ...current,
            genres: payload.genres,
          }))
        })
        .catch(() => {
          // Keep existing suggestions on transient failures.
        })
    }, 250)

    return () => {
      isStale = true
      window.clearTimeout(timeoutId)
    }
  }, [authToken, genreInput])

  useEffect(() => {
    const keyword = tagInput.trim()
    if (keyword === '') {
      return
    }

    let isStale = false
    const timeoutId = window.setTimeout(() => {
      void suggestMetadataSuggestions(keyword, authToken)
        .then((payload) => {
          if (isStale) {
            return
          }
          setMetadataSuggestions((current) => ({
            ...current,
            tags: normalizeTagList(payload.tags),
          }))
        })
        .catch(() => {
          // Keep existing suggestions on transient failures.
        })
    }, 250)

    return () => {
      isStale = true
      window.clearTimeout(timeoutId)
    }
  }, [authToken, tagInput])

  const handleThumbnailUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null
      if (file === null) {
        return
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        updateDraft({ source_thumbnail_data_url: dataUrl })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load image file')
      } finally {
        event.currentTarget.value = ''
        setContextMenu(null)
      }
    },
    [updateDraft],
  )

  const openLyricsSearch = useCallback(() => {
    const search = `${draft.title.trim()} lyrics`.trim()
    window.open(`https://www.google.com/search?q=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer')
  }, [draft.title])

  const previewOnYoutube = useCallback(() => {
    window.open(draft.source_url, '_blank', 'noopener,noreferrer')
  }, [draft.source_url])

  const handleEnhance = useCallback(async () => {
    setIsEnhancing(true)
    setEnhanceMessage('')
    try {
      const response = await suggestEnhance(draft, authToken)
      if (response.status === 'success' || response.status === 'degraded') {
        const enhanced = response.enhanced
        updateDraft({
          title: enhanced.title,
          artist: enhanced.artist,
          language: enhanced.language || '',
          is_off_vocal: enhanced.is_off_vocal,
          video_has_lyrics: enhanced.video_has_lyrics,
          genre: enhanced.genre || '',
          tags: enhanced.tags || [],
          lyrics: enhanced.lyrics || '',
          isEnhanced: true,
        })
        setIsDetailsOpen(true)
        setEnhanceMessage(response.status === 'degraded' ? '✓ Enhanced (partial)' : '✓ Enhanced successfully!')
        setTimeout(() => setEnhanceMessage(''), 3000)
      } else {
        setEnhanceMessage('Enhancement failed')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Enhancement failed'
      setEnhanceMessage(`Error: ${message}`)
    } finally {
      setIsEnhancing(false)
    }
  }, [draft, authToken, updateDraft])

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
              disabled={isEnhancing || isSubmitting}
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
            <section className="panel thumbnail-panel">
            <h2>Thumbnail</h2>
            <div
              className="thumbnail-preview"
              onClick={(e) => {
                openThumbnailContextMenu(e.currentTarget)
              }}
              style={{ cursor: 'pointer', position: 'relative' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openThumbnailContextMenu(e.currentTarget)
                }
              }}
            >
              {previewUrl !== '' ? (
                <img src={previewUrl} alt={draft.title} />
              ) : (
                <div className="thumbnail-placeholder">No thumbnail available</div>
              )}
              <button
                type="button"
                className="thumbnail-edit-button"
                aria-label="Edit thumbnail"
                onClick={(e) => {
                  e.stopPropagation()
                  const previewElement = e.currentTarget.closest('.thumbnail-preview')
                  if (previewElement instanceof HTMLElement) {
                    openThumbnailContextMenu(previewElement)
                  }
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  photo_camera
                </span>
              </button>
            </div>

            {contextMenu && (
              <div
                style={{
                  position: 'fixed',
                  top: contextMenu.y,
                  left: contextMenu.x,
                  backgroundColor: 'var(--surface-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                  zIndex: 1000,
                  minWidth: 180,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    thumbnailFileInputRef.current?.click()
                    setContextMenu(null)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Upload Thumbnail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateDraft({
                      source_thumbnail_data_url: originalDraft.source_thumbnail_data_url,
                      source_thumbnail: originalDraft.source_thumbnail,
                    })
                    setContextMenu(null)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    borderTop: '1px solid var(--border-primary)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Reset Thumbnail
                </button>
              </div>
            )}
            {contextMenu && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 999,
                }}
                onClick={() => setContextMenu(null)}
              />
            )}

            <input
              ref={thumbnailFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleThumbnailUpload}
              style={{ display: 'none' }}
            />
          </section>

          <section className="panel">
            <h2>Song Details</h2>
            <div className="form">
              <label>
                Title
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  required
                />
              </label>
              <label>
                Artist
                <input
                  value={draft.artist}
                  onChange={(event) => updateDraft({ artist: event.target.value })}
                  required
                />
              </label>
              <div className="checkbox-grid">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.is_off_vocal}
                    onChange={(event) => updateDraft({ is_off_vocal: event.target.checked })}
                  />
                  Is Off Vocal
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.video_has_lyrics}
                    onChange={(event) => updateDraft({ video_has_lyrics: event.target.checked })}
                  />
                  Video Has Lyrics
                </label>
              </div>
              <p className="subtitle">
                Source URL:{' '}
                <a href={draft.source_url} target="_blank" rel="noreferrer">
                  {draft.source_url}
                </a>
              </p>
              <p className="subtitle">
                Source ID: <code>{draft.source_id}</code>
              </p>
              <p className="subtitle">
                Source: <code>{draft.source}</code>
              </p>
            </div>
          </section>

        </div>

        <CollapsibleSection title="More details" isOpen={isDetailsOpen} onToggle={() => setIsDetailsOpen((open) => !open)}>
          <div className="row-actions">
            <button
              type="button"
              className="youtube-button"
              disabled={isEnhancing || isSubmitting}
              onClick={previewOnYoutube}
            >
              Preview on Youtube
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isEnhancing || isSubmitting}
              onClick={handleEnhance}
              title={isEnhancing ? 'Enhancing...' : 'Use AI to enhance song metadata'}
            >
              {isEnhancing ? 'Enhancing...' : 'Enhance'} <span aria-hidden="true">✦</span>
            </button>
            {enhanceMessage && (
              <span
                className="enhance-message"
                style={{ color: enhanceMessage.startsWith('Error') ? '#d32f2f' : '#4caf50' }}
              >
                {enhanceMessage}
              </span>
            )}
          </div>
          <label>
            Language
            <select
              value={normalizeLanguageCodeForUi(draft.language) || 'other'}
              onChange={(event) => updateDraft({ language: event.target.value })}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <section className="panel">
            <label>
              Genre
              <input
                value={draft.genre}
                list="genre-suggestions"
                onChange={(event) => {
                  const nextValue = event.target.value
                  setGenreInput(nextValue)
                  updateDraft({ genre: nextValue })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                  }
                }}
                placeholder="Pop, ballad, rock..."
              />
              {metadataSuggestions.genres.length > 0 ? (
                <datalist id="genre-suggestions">
                  {metadataSuggestions.genres
                    .filter((suggestion) => suggestion !== draft.genre)
                    .map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                </datalist>
              ) : null}
              {metadataSuggestions.genres.length > 0 ? (
                <div className="chip-suggestion-list top-gap">
                  {metadataSuggestions.genres
                    .filter((suggestion) => suggestion !== draft.genre)
                    .map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="chip-suggestion"
                        onClick={() => {
                          setGenreInput(suggestion)
                          updateDraft({ genre: suggestion })
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                </div>
              ) : null}
              <span className="field-help">
                Optional — leave blank to have it filled in automatically after downloading.
              </span>
            </label>
            <div className="top-gap">
              <ChipField
                label="Tags"
                values={draft.tags}
                inputValue={tagInput}
                placeholder="romantic, duet, female vocal..."
                helperText="Optional tags (saved as lowercase) separated by commas or Enter."
                suggestions={metadataSuggestions.tags.filter((item) => !draft.tags.includes(item))}
                onInputValueChange={setTagInput}
                onCommitValue={commitTags}
                onSelectSuggestion={(value) => {
                  updateDraft({ tags: normalizeTagList([...draft.tags, value]) })
                  setTagInput('')
                }}
                onRemoveValue={(index) =>
                  updateDraft({ tags: draft.tags.filter((_, itemIndex) => itemIndex !== index) })
                }
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Lyrics</h2>
              <button type="button" className="secondary" onClick={openLyricsSearch}>
                Search Lyrics on Google
              </button>
            </div>
            <label className="top-gap">
              Lyrics
              <textarea
                value={draft.lyrics}
                onChange={(event) => updateDraft({ lyrics: event.target.value })}
                rows={10}
                placeholder="Paste lyrics here..."
              />
            </label>
          </section>
        </CollapsibleSection>
        {showDownloadAndReserve && (normalizedReserveTargetOptions.length > 0 || allowCustomReserveTarget) ? (
          <div className="form top-gap">
            <label>
              {reserveTargetLabel}
              <select
                value={reserveTargetChoice}
                onChange={(event) => setReserveTargetChoice(event.target.value)}
                disabled={isEnhancing || isSubmitting}
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
                  disabled={isEnhancing || isSubmitting}
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
        {isEnhancing || isSubmitting ? (
          <BlockingHud message={isEnhancing ? 'Enhancing song details...' : 'Saving song...'} />
        ) : null}
      </section>
    </main>
  )
}
