import { CollapsibleSection } from './CollapsibleSection'
import { ChipField } from './ChipField'
import { LANGUAGE_OPTIONS } from '../../../shared/config/client'
import { normalizeLanguageCodeForUi } from '../../../shared/lib/format'
import type { SuggestDraft, SuggestMetadataSuggestionsResponse } from '../../../shared/types/client'

type MoreDetailsPanelProps = {
  isOpen: boolean
  onToggle: () => void
  draft: SuggestDraft
  onUpdate: (patch: Partial<SuggestDraft>) => void
  isEnhancing: boolean
  isSubmitting: boolean
  enhanceMessage: string
  onEnhance: () => void
  onPreviewOnYoutube: () => void
  onGenreInputChange: (value: string) => void
  metadataSuggestions: SuggestMetadataSuggestionsResponse
  tagInput: string
  onTagInputChange: (value: string) => void
  onCommitTags: () => void
  onOpenLyricsSearch: () => void
}

export function MoreDetailsPanel({
  isOpen,
  onToggle,
  draft,
  onUpdate,
  isEnhancing,
  isSubmitting,
  enhanceMessage,
  onEnhance,
  onPreviewOnYoutube,
  onGenreInputChange,
  metadataSuggestions,
  tagInput,
  onTagInputChange,
  onCommitTags,
  onOpenLyricsSearch,
}: MoreDetailsPanelProps) {
  return (
    <CollapsibleSection title="More details" isOpen={isOpen} onToggle={onToggle}>
      <div className="row-actions">
        <button
          type="button"
          className="youtube-button"
          disabled={isEnhancing || isSubmitting}
          onClick={onPreviewOnYoutube}
        >
          Preview on Youtube
        </button>
        <button
          type="button"
          className="secondary"
          disabled={isEnhancing || isSubmitting}
          onClick={onEnhance}
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
          onChange={(event) => onUpdate({ language: event.target.value })}
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
              onGenreInputChange(nextValue)
              onUpdate({ genre: nextValue })
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
                      onGenreInputChange(suggestion)
                      onUpdate({ genre: suggestion })
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
            onInputValueChange={onTagInputChange}
            onCommitValue={onCommitTags}
            onSelectSuggestion={(value) => {
              onUpdate({ tags: [...draft.tags, value] })
              onTagInputChange('')
            }}
            onRemoveValue={(index) =>
              onUpdate({ tags: draft.tags.filter((_, itemIndex) => itemIndex !== index) })
            }
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Lyrics</h2>
          <button type="button" className="secondary" onClick={onOpenLyricsSearch}>
            Search Lyrics on Google
          </button>
        </div>
        <label className="top-gap">
          Lyrics
          <textarea
            value={draft.lyrics}
            onChange={(event) => onUpdate({ lyrics: event.target.value })}
            rows={10}
            placeholder="Paste lyrics here..."
          />
        </label>
      </section>
    </CollapsibleSection>
  )
}
