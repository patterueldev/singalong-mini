import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { StoredAuth, SongbookSong } from '../../../shared/types/client'
import { useAdminService } from '../hooks/useAdminService'
import { formatLanguageLabel } from '../../../shared/lib/format'
import { splitChipInput } from '../../../shared/lib/suggest'
import { readFileAsDataUrl } from '../../../shared/lib/files'
import { SkeletonList } from '../../songbook/components/SkeletonList'

type AdminSongbookPageProps = {
  auth: StoredAuth
}

function buildCompactPagination(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1, 2, totalPages - 1])
  const sortedPages = Array.from(pages)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right)

  const result: Array<number | 'ellipsis'> = []
  let previous: number | null = null
  for (const current of sortedPages) {
    if (previous !== null && current - previous > 1) {
      result.push('ellipsis')
    }
    result.push(current)
    previous = current
  }
  return result
}

function getAttentionLabel(_: SongbookSong) {
  if (_.validatedByAdmin) {
    return 'Validated'
  }
  return _.qualityScore > 0 ? `Attention ${_.qualityScore}` : 'Healthy'
}

function getAttentionClass(song: SongbookSong) {
  if (song.validatedByAdmin) {
    return 'success'
  }
  if (song.qualityScore >= 50) {
    return 'critical'
  }
  if (song.qualityScore >= 20) {
    return 'warning'
  }
  return 'notice'
}

function getAttentionTooltip(song: SongbookSong) {
  if (song.validatedByAdmin) {
    return 'Marked as validated by an admin.'
  }
  if (song.qualityFlags.length === 0) {
    return 'No quality issues detected.'
  }

  return song.qualityFlags.map((flag) => `${flag.label}: ${flag.message}`).join(' • ')
}

function SongPreviewModal({
  song,
  onClose,
}: {
  song: SongbookSong
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Song Preview</h2>
            <p className="subtitle">{song.artist}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="song-detail-layout top-gap">
          <div className="song-detail-video-panel">
            {song.videoFile ? (
              <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
            ) : (
              <p className="empty-state">Video not available.</p>
            )}
          </div>

          <div className="song-detail-panels">
            <div className="song-detail-summary-panel">
              <div className="song-detail-header-row">
                {song.thumbnailUrl ? (
                  <img className="song-detail-thumbnail song-detail-thumbnail--small" src={song.thumbnailUrl} alt={song.title} />
                ) : (
                  <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                )}
                <div className="song-detail-meta">
                  <h1 className="song-detail-title">{song.title}</h1>
                  <p className="subtitle">{song.artist}</p>
                </div>
              </div>

              <dl className="song-detail-grid top-gap">
                <div>
                  <dt>Language</dt>
                  <dd>{formatLanguageLabel(song.language)}</dd>
                </div>
                <div>
                  <dt>Genre</dt>
                  <dd>{song.genre ?? '—'}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{song.duration}</dd>
                </div>
                <div>
                  <dt>Added by</dt>
                  <dd>{song.addedByUsername ?? '—'}</dd>
                </div>
                {song.sourceId ? (
                  <div className="song-detail-grid-wide">
                    <dt>Source ID</dt>
                    <dd>{song.sourceId}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="song-detail-chips top-gap">
                {song.language ? <span className="chip-badge">{formatLanguageLabel(song.language)}</span> : null}
                {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                <span
                  className={`chip-badge admin-songbook-quality ${getAttentionClass(song)}`}
                  title={getAttentionTooltip(song)}
                >
                  {getAttentionLabel(song)}
                </span>
                {song.duration ? <span className="chip-badge">{song.duration}</span> : null}
                {song.tags.map((tag) => (
                  <span key={tag} className="chip-badge chip-badge--tag">
                    {tag}
                  </span>
                ))}
              </div>

              {song.sourceUrl ? (
                <div className="row-actions song-detail-actions">
                  <button
                    type="button"
                    className="youtube-button"
                    onClick={() => window.open(song.sourceUrl!, '_blank', 'noopener,noreferrer')}
                  >
                    View on Youtube
                  </button>
                </div>
              ) : null}
            </div>

            <div className="song-detail-lyrics-panel">
              <h3>Lyrics</h3>
              <p className="song-detail-lyrics">
                {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function SongEditModal({
  song,
  thumbnailDataUrl,
  isSaving,
  onClose,
  onSongChange,
  onThumbnailDataUrlChange,
  onSave,
}: {
  song: SongbookSong
  thumbnailDataUrl: string | null
  isSaving: boolean
  onClose: () => void
  onSongChange: (song: SongbookSong) => void
  onThumbnailDataUrlChange: (value: string | null) => void
  onSave: () => void
}) {
  return (
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal song-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Edit Song Details</h2>
            <p className="subtitle">{song.artist}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </div>

        <div className="song-detail-layout song-editor-layout">
          <div className="song-detail-video-panel">
            {song.videoFile ? (
              <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
            ) : (
              <p className="empty-state">Video not available.</p>
            )}
          </div>

          <div className="song-detail-panels song-editor-panels">
            <div className="song-detail-summary-panel">
              <div className="song-detail-header-row song-editor-header-row">
                {thumbnailDataUrl !== null ? (
                  <img className="song-detail-thumbnail song-detail-thumbnail--small" src={thumbnailDataUrl} alt={song.title} />
                ) : song.thumbnailUrl ? (
                  <img className="song-detail-thumbnail song-detail-thumbnail--small" src={song.thumbnailUrl} alt={song.title} />
                ) : (
                  <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                )}

                <div className="song-detail-meta song-editor-meta">
                  <input
                    className="song-editor-input song-editor-input--title"
                    value={song.title}
                    onChange={(event) => onSongChange({ ...song, title: event.target.value })}
                    placeholder="Title"
                    aria-label="Title"
                  />
                  <input
                    className="song-editor-input song-editor-input--artist"
                    value={song.artist}
                    onChange={(event) => onSongChange({ ...song, artist: event.target.value })}
                    placeholder="Artist"
                    aria-label="Artist"
                  />
                </div>
              </div>

              <div className="song-editor-meta-grid top-gap">
                <label>
                  Language
                  <input
                    className="song-editor-input"
                    value={song.language ?? ''}
                    onChange={(event) => onSongChange({ ...song, language: event.target.value || null })}
                    placeholder="Language"
                  />
                </label>
                <label>
                  Genre
                  <input
                    className="song-editor-input"
                    value={song.genre ?? ''}
                    onChange={(event) => onSongChange({ ...song, genre: event.target.value || null })}
                    placeholder="Genre"
                  />
                </label>
                <label className="song-editor-meta-grid-wide">
                  Tags (comma-separated)
                  <input
                    className="song-editor-input"
                    value={song.tags.join(', ')}
                    onChange={(event) => onSongChange({ ...song, tags: splitChipInput(event.target.value) })}
                    placeholder="tag one, tag two"
                  />
                </label>
                <label className="song-editor-meta-grid-wide">
                  Thumbnail image
                  <input
                    className="song-editor-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file === undefined) {
                        return
                      }
                      void readFileAsDataUrl(file).then((dataUrl) => onThumbnailDataUrlChange(dataUrl))
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="song-detail-lyrics-panel">
              <h3>Lyrics</h3>
              <textarea
                value={song.lyrics ?? ''}
                onChange={(event) => onSongChange({ ...song, lyrics: event.target.value || null })}
                placeholder="Lyrics"
              />
            </div>
          </div>
        </div>

        <div className="row-actions top-gap">
          <button type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminSongbookPage({ auth }: AdminSongbookPageProps) {
  const navigate = useNavigate()
  const {
    archiveSong,
    fetchSongbook,
    searchSongbook,
    setSongValidation,
    updateSongAdminDetails,
  } = useAdminService()
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [previewSong, setPreviewSong] = useState<SongbookSong | null>(null)
  const [editingSong, setEditingSong] = useState<SongbookSong | null>(null)
  const [editingSongThumbnailDataUrl, setEditingSongThumbnailDataUrl] = useState<string | null>(null)
  const [isSavingSong, setIsSavingSong] = useState(false)
  const [archivingSongId, setArchivingSongId] = useState<string | null>(null)
  const [validationSongId, setValidationSongId] = useState<string | null>(null)

  const loadSongs = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const payload =
        query.trim() === ''
          ? await fetchSongbook(page, 25)
          : await searchSongbook(query.trim(), page, 25)
      setSongs(payload.items)
      setPages(payload.pages)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load songbook')
    } finally {
      setIsLoading(false)
    }
  }, [fetchSongbook, page, query, searchSongbook])

  useEffect(() => {
    void loadSongs()
  }, [loadSongs])

  useEffect(() => {
    setPage(1)
  }, [query])

  const attentionCount = useMemo(
    () => songs.filter((song) => song.qualityScore > 0).length,
    [songs],
  )

  const handleSaveSong = useCallback(async () => {
    if (editingSong === null) {
      return
    }

    setIsSavingSong(true)
    setErrorMessage('')
    try {
      const updated = await updateSongAdminDetails(editingSong.id, auth.accessToken, {
        title: editingSong.title,
        artist: editingSong.artist,
        language: editingSong.language,
        genre: editingSong.genre,
        tags: editingSong.tags,
        lyrics: editingSong.lyrics,
        source_thumbnail_data_url: editingSongThumbnailDataUrl,
      })
      setEditingSong(updated)
      setSongs((current) => current.map((song) => (song.id === updated.id ? updated : song)))
      setMessage('Song updated.')
      setEditingSongThumbnailDataUrl(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update song')
    } finally {
      setIsSavingSong(false)
    }
  }, [auth.accessToken, editingSong, editingSongThumbnailDataUrl, updateSongAdminDetails])

  const handleArchiveSong = useCallback(
    async (song: SongbookSong) => {
      if (!window.confirm(`Archive "${song.title}"?`)) {
        return
      }

      setArchivingSongId(song.id)
      setErrorMessage('')
      try {
        const payload = await archiveSong(song.id, auth.accessToken)
        setMessage(payload.message)
        await loadSongs()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to archive song')
      } finally {
        setArchivingSongId(null)
      }
    },
    [archiveSong, auth.accessToken, loadSongs],
  )

  const handleToggleValidation = useCallback(
    async (song: SongbookSong) => {
      setValidationSongId(song.id)
      setErrorMessage('')
      try {
        const updated = await setSongValidation(song.id, auth.accessToken, !song.validatedByAdmin)
        setSongs((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
        if (editingSong?.id === updated.id) {
          setEditingSong(updated)
        }
        if (previewSong?.id === updated.id) {
          setPreviewSong(updated)
        }
        setMessage(updated.validatedByAdmin ? 'Song marked as validated.' : 'Song validation cleared.')
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to update validation state')
      } finally {
        setValidationSongId(null)
      }
    },
    [auth.accessToken, editingSong, previewSong, setSongValidation],
  )

  const handleOpenEdit = useCallback((song: SongbookSong) => {
    setPreviewSong(null)
    setEditingSong(song)
    setEditingSongThumbnailDataUrl(null)
  }, [])

  const closeEdit = useCallback(() => {
    if (isSavingSong) {
      return
    }
    setEditingSong(null)
    setEditingSongThumbnailDataUrl(null)
  }, [isSavingSong])

  const closePreview = useCallback(() => setPreviewSong(null), [])

  return (
    <main className="app-shell admin-songbook-shell">
      <section className="card admin-songbook-card">
        <div className="card-header admin-songbook-header">
          <div>
            <h1>Songbook Management</h1>
            <p className="subtitle">
              Manage songs, edit metadata, and archive records from a table-first admin view.
            </p>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => navigate('/admin/dashboard')}>
              Dashboard
            </button>
            <button type="button" className="secondary" onClick={() => navigate('/admin/songbook/suggest/search')}>
              Suggest Song
            </button>
            <button type="button" className="secondary" onClick={() => void loadSongs()}>
              Refresh
            </button>
          </div>
        </div>

        <div className="metrics">
          <div>
            <span className="metric-label">Songs</span>
            <strong>{total}</strong>
          </div>
          <div>
            <span className="metric-label">Attention lane</span>
            <strong>{attentionCount}</strong>
          </div>
        </div>

        <div className="admin-songbook-toolbar top-gap">
          <label className="admin-songbook-search">
            Search songs
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Title, artist, genre, tag..."
            />
          </label>
          <div className="row-actions admin-songbook-toolbar-actions">
            <button type="button" className="secondary" onClick={() => setQuery('')}>
              Clear
            </button>
          </div>
        </div>

        {message !== '' ? <p className="success-message">{message}</p> : null}
        {errorMessage !== '' ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="admin-songbook-table">
          <div className="admin-songbook-table-header">
            <span>Song</span>
            <span>Metadata</span>
            <span>Attention</span>
            <span>Actions</span>
          </div>

          {isLoading ? (
            <div className="top-gap">
              <SkeletonList count={3} />
            </div>
          ) : songs.length === 0 ? (
            <p className="empty-state top-gap">No songs found.</p>
          ) : (
            songs.map((song) => (
              <article className="admin-songbook-row" key={song.id}>
                <div className="admin-songbook-song">
                  <div className="song-detail-header-row">
                    {song.thumbnailUrl ? (
                      <img
                        className="song-detail-thumbnail song-detail-thumbnail--small"
                        src={song.thumbnailUrl}
                        alt={song.title}
                      />
                    ) : (
                      <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                    )}
                    <div className="song-detail-meta">
                      <strong>{song.title}</strong>
                      <p className="session-meta">
                        {song.artist}
                        {song.duration ? ` · ${song.duration}` : ''}
                      </p>
                    </div>
                  </div>
                  <p className="session-meta admin-songbook-song-meta">
                    {song.addedByUsername ? <>Added by {song.addedByUsername}</> : 'Added by —'}
                    {song.sourceId ? ` · Source ${song.sourceId}` : ''}
                  </p>
                </div>

                <div className="admin-songbook-metadata">
                  <p className="session-meta">
                    {formatLanguageLabel(song.language)} · {song.genre ?? 'No genre'}
                  </p>
                  <div className="song-detail-chips admin-songbook-chips">
                    {song.language ? <span className="chip-badge">{formatLanguageLabel(song.language)}</span> : null}
                    {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                    <span
                      className={`chip-badge admin-songbook-quality ${getAttentionClass(song)}`}
                      title={getAttentionTooltip(song)}
                    >
                      {getAttentionLabel(song)}
                    </span>
                    {song.tags.map((tag) => (
                      <span key={tag} className="chip-badge chip-badge--tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  </div>

                  <div className="admin-songbook-attention">
                    <span
                      className={`badge admin-songbook-attention-badge ${getAttentionClass(song)}`}
                      title={getAttentionTooltip(song)}
                    >
                      {getAttentionLabel(song)}
                    </span>
                  </div>

                <div className="row-actions admin-songbook-actions">
                  <button type="button" className="secondary" onClick={() => handleOpenEdit(song)}>
                    Edit Details
                  </button>
                  <button type="button" className="secondary" onClick={() => setPreviewSong(song)}>
                    View Details
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void handleArchiveSong(song)}
                    disabled={archivingSongId === song.id}
                  >
                    {archivingSongId === song.id ? 'Archiving…' : 'Archive Song'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void handleToggleValidation(song)}
                    disabled={validationSongId === song.id}
                  >
                    {validationSongId === song.id
                      ? 'Saving…'
                      : song.validatedByAdmin
                        ? 'Clear Validation'
                        : 'Mark Validated'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {pages > 1 ? (
          <div className="pagination admin-songbook-pagination">
            <button
              type="button"
              className="icon-control-button pagination-arrow-button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              title="Previous page"
              aria-label="Previous page"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <div className="pagination-pages">
              {buildCompactPagination(page, pages).map((item, index) =>
                item === 'ellipsis' ? (
                  <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`pagination-page-button ${item === page ? 'active' : ''}`}
                    onClick={() => setPage(item)}
                    aria-current={item === page ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="icon-control-button pagination-arrow-button"
              disabled={page >= pages}
              onClick={() => setPage((current) => Math.min(pages, current + 1))}
              title="Next page"
              aria-label="Next page"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        ) : null}
      </section>

      {previewSong !== null ? <SongPreviewModal song={previewSong} onClose={closePreview} /> : null}

      {editingSong !== null ? (
        <SongEditModal
          song={editingSong}
          thumbnailDataUrl={editingSongThumbnailDataUrl}
          isSaving={isSavingSong}
          onClose={closeEdit}
          onSongChange={setEditingSong}
          onThumbnailDataUrlChange={setEditingSongThumbnailDataUrl}
          onSave={() => void handleSaveSong()}
        />
      ) : null}
    </main>
  )
}
