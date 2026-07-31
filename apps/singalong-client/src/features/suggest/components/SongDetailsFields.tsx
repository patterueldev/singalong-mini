import type { SuggestDraft } from '../../../shared/types/client'

type SongDetailsFieldsProps = {
  draft: SuggestDraft
  onUpdate: (patch: Partial<SuggestDraft>) => void
}

export function SongDetailsFields({ draft, onUpdate }: SongDetailsFieldsProps) {
  return (
    <section className="panel">
      <h2>Song Details</h2>
      <div className="form">
        <label>
          Title
          <input
            value={draft.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            required
          />
        </label>
        <label>
          Artist
          <input
            value={draft.artist}
            onChange={(event) => onUpdate({ artist: event.target.value })}
            required
          />
        </label>
        <div className="checkbox-grid">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.is_off_vocal}
              onChange={(event) => onUpdate({ is_off_vocal: event.target.checked })}
            />
            Is Off Vocal
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.video_has_lyrics}
              onChange={(event) => onUpdate({ video_has_lyrics: event.target.checked })}
            />
            Video Has Lyrics
          </label>
        </div>
        <p className="subtitle">
          Source:{' '}
          <a href={draft.source_url} target="_blank" rel="noreferrer">
            {draft.source_url}
          </a>
        </p>
      </div>
    </section>
  )
}
