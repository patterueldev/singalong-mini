import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DownloadProgressItem, StoredAuth, SongbookSong, WSIncoming } from '../../../shared/types/client'
import { buildWSUrl } from '../../../shared/api/ws'
import { useAdminService } from '../hooks/useAdminService'
import { useGuestService } from '../../guest/hooks/useGuestService'
import { formatLanguageLabel, normalizeLanguageCodeForUi } from '../../../shared/lib/format'
import { LANGUAGE_OPTIONS } from '../../../shared/config/client'
import { readFileAsDataUrl } from '../../../shared/lib/files'
import { normalizeTagList, splitChipInput } from '../../../shared/lib/suggest'
import { mergeDownloadProgressItems, normalizeDownloadProgressItems } from '../../shared/services/queueTransforms'
import { DownloadProgressModal } from '../../songbook/components/DownloadProgressModal'
import { SongDetailsModal } from '../../songbook/components/SongDetailsModal'
import { SkeletonList } from '../../songbook/components/SkeletonList'
import { ChipField } from '../../suggest/components/ChipField'
import { SongTrimModal } from '../components/SongTrimModal'

type AdminSongbookPageProps = {
  auth: StoredAuth
}

type SongSortKey = 'attention' | 'status' | 'title' | 'added'
type SortDirection = 'asc' | 'desc'

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

function getSongStatusLabel(status: string) {
  if (status === 'draft') {
    return 'Pending'
  }
  if (status === 'downloading') {
    return 'Downloading'
  }
  if (status === 'published') {
    return 'Published'
  }
  if (status === 'error') {
    return 'Error'
  }
  if (status === 'archived') {
    return 'Archived'
  }
  return status
}

function getSongStatusClass(status: string) {
  if (status === 'published') {
    return 'success'
  }
  if (status === 'downloading' || status === 'draft') {
    return 'warning'
  }
  if (status === 'error') {
    return 'critical'
  }
  return 'notice'
}

function formatAddedAt(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return '—'
  }
  return new Date(timestamp).toLocaleString()
}

function SongPreviewModal({
  song,
  onClose,
}: {
  song: SongbookSong
  onClose: () => void
}) {
  return <SongDetailsModal isOpen song={song} onClose={onClose} />
}

export function SongEditModal({
  song,
  thumbnailDataUrl,
  isSaving,
  onClose,
  onSongChange,
  onThumbnailDataUrlChange,
  onSave,
  onArchive = undefined,
  isArchiving = false,
  onMagicFixDuration = undefined,
  tagSuggestions,
  onTrimClick,
  showTrimAction = true,
  showArchiveAction = true,
  showMagicFixAction = true,
}: {
  song: SongbookSong
  thumbnailDataUrl: string | null
  isSaving: boolean
  onClose: () => void
  onSongChange: (song: SongbookSong) => void
  onThumbnailDataUrlChange: (value: string | null) => void
  onSave: () => void
  onArchive?: () => void
  isArchiving?: boolean
  onMagicFixDuration?: () => void
  tagSuggestions: string[]
  onTrimClick?: () => void
  showTrimAction?: boolean
  showArchiveAction?: boolean
  showMagicFixAction?: boolean
}) {
  const [tagInput, setTagInput] = useState('')
  const thumbnailFileInputRef = useRef<HTMLInputElement>(null)

  const displayedThumbnail = thumbnailDataUrl ?? song.thumbnailUrl
  const trimDurationLabel = song.duration?.trim() ? song.duration : '--:--'

  const commitTags = () => {
    const nextValues = splitChipInput(tagInput, (entry) => entry.trim().toLowerCase())
    if (nextValues.length === 0) {
      return
    }
    onSongChange({ ...song, tags: normalizeTagList([...song.tags, ...nextValues]) })
    setTagInput('')
  }

  const openLyricsSearch = () => {
    const search = `${song.title.trim()} lyrics`.trim()
    window.open(`https://www.google.com/search?q=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer')
  }

  const filteredTagSuggestions = useMemo(() => {
    const keyword = tagInput.trim().toLowerCase()
    if (keyword === '') {
      return []
    }
    return tagSuggestions
      .filter((item) => !song.tags.includes(item) && item.includes(keyword))
      .slice(0, 12)
  }, [song.tags, tagInput, tagSuggestions])

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
          <h2>Edit Song Details</h2>
          <div className="song-editor-header-actions">
            {showMagicFixAction ? (
              <button
                type="button"
                className="icon-control-button"
                onClick={onMagicFixDuration}
                disabled={isSaving || !song.videoFile || onMagicFixDuration === undefined}
                title="Magic fix duration"
                aria-label="Magic fix duration"
              >
                <span className="material-symbols-outlined">auto_fix_high</span>
              </button>
            ) : null}
            <button
              type="button"
              className="icon-control-button"
              onClick={onClose}
              disabled={isSaving}
              title="Close"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="song-editor-form top-gap">
          <div className="song-editor-grid">
            <section className="song-editor-panel song-editor-panel-left">
              <div className="form-field">
                <div className="thumbnail-preview-container">
                    <div
                      className="song-editor-thumbnail-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => thumbnailFileInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          thumbnailFileInputRef.current?.click()
                        }
                      }}
                      aria-label="Change thumbnail"
                    >
                      {displayedThumbnail ? (
                        <img className="thumbnail-preview" src={displayedThumbnail} alt={song.title} />
                      ) : (
                        <div className="thumbnail-preview thumbnail-preview--empty">
                          No thumbnail
                        </div>
                      )}
                      <span className="thumbnail-edit-button" aria-hidden="true">
                        <span className="material-symbols-outlined">photo_camera</span>
                      </span>
                    </div>
                </div>
                <input
                    ref={thumbnailFileInputRef}
                    className="hidden-file-input"
                    id="thumbnail-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file === undefined) {
                        return
                      }
                      void readFileAsDataUrl(file).then((dataUrl) => onThumbnailDataUrlChange(dataUrl))
                    }}
                    disabled={isSaving}
                />
              </div>

              <label className="form-field">
                <span className="form-label">Title</span>
                <input
                  className="form-input"
                  type="text"
                  value={song.title}
                  onChange={(event) => onSongChange({ ...song, title: event.target.value })}
                  placeholder="Song title"
                  disabled={isSaving}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Artist</span>
                <input
                  className="form-input"
                  type="text"
                  value={song.artist}
                  onChange={(event) => onSongChange({ ...song, artist: event.target.value })}
                  placeholder="Artist name"
                  disabled={isSaving}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Genre</span>
                <input
                  className="form-input"
                  type="text"
                  value={song.genre ?? ''}
                  onChange={(event) => onSongChange({ ...song, genre: event.target.value || null })}
                  placeholder="Genre"
                  disabled={isSaving}
                />
              </label>
            </section>

            <section className="song-editor-panel song-editor-panel-right">
              <div className="form-field">
                {song.videoFile ? (
                  <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
                ) : (
                  <p className="empty-state">Video not available.</p>
                )}
              </div>

              <div className="row-actions song-editor-video-actions">
                {showTrimAction ? (
                  onTrimClick && song.videoFile ? (
                    <button type="button" className="secondary" onClick={onTrimClick} disabled={isSaving}>
                      Trim Video ({trimDurationLabel})
                    </button>
                  ) : (
                    <button type="button" className="secondary" disabled>
                      Trim Video ({trimDurationLabel})
                    </button>
                  )
                ) : null}
                {song.sourceUrl ? (
                  <button
                    type="button"
                    className="youtube-button"
                    onClick={() => window.open(song.sourceUrl!, '_blank', 'noopener,noreferrer')}
                    disabled={isSaving}
                  >
                    View Source
                  </button>
                ) : (
                  <button type="button" className="youtube-button" disabled>
                    View Source
                  </button>
                )}
              </div>

              <label className="form-field">
                <span className="form-label">Language</span>
                <select
                  className="form-input"
                  value={normalizeLanguageCodeForUi(song.language) || 'other'}
                  onChange={(event) => onSongChange({ ...song, language: event.target.value })}
                  disabled={isSaving}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field form-field--checkbox">
                <input
                  type="checkbox"
                  checked={song.videoHasLyrics}
                  onChange={(event) => onSongChange({ ...song, videoHasLyrics: event.target.checked })}
                  disabled={isSaving}
                />
                <span>Video Has Lyrics</span>
              </label>

              <label className="form-field form-field--checkbox">
                <input
                  type="checkbox"
                  checked={song.isOffVocal}
                  onChange={(event) => onSongChange({ ...song, isOffVocal: event.target.checked })}
                  disabled={isSaving}
                />
                <span>Is Off Vocal</span>
              </label>

              <label className="form-field form-field--checkbox">
                <input
                  type="checkbox"
                  checked={song.validatedByAdmin ?? false}
                  onChange={(event) => onSongChange({ ...song, validatedByAdmin: event.target.checked })}
                  disabled={isSaving}
                />
                <span>Marked as validated by admin</span>
              </label>
            </section>
          </div>

          <section className="song-editor-panel song-editor-panel-bottom">
            <div className="song-editor-bottom-grid">
              <div className="form-field">
                <ChipField
                  label="Tags"
                  values={song.tags}
                  inputValue={tagInput}
                  placeholder="romantic, duet, female vocal..."
                  helperText="Optional tags (saved as lowercase) separated by commas or Enter."
                  datalistId="admin-edit-tag-suggestions"
                  suggestions={filteredTagSuggestions}
                  onInputValueChange={setTagInput}
                  onCommitValue={commitTags}
                  onSelectSuggestion={(value) => {
                    onSongChange({ ...song, tags: normalizeTagList([...song.tags, value]) })
                    setTagInput('')
                  }}
                  onRemoveValue={(value) => onSongChange({ ...song, tags: song.tags.filter((item) => item !== value) })}
                />
              </div>

              <div className="form-field">
                <div className="panel-header">
                  <h3>Lyrics</h3>
                  <button type="button" className="secondary" onClick={openLyricsSearch} disabled={isSaving}>
                    Search Lyrics
                  </button>
                </div>
                <textarea
                  className="form-textarea"
                  value={song.lyrics ?? ''}
                  onChange={(event) => onSongChange({ ...song, lyrics: event.target.value || null })}
                  placeholder="Song lyrics..."
                  rows={10}
                  disabled={isSaving}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="row-actions top-gap song-editor-save-actions">
          {showArchiveAction ? (
            <button
              type="button"
              className="danger-button"
              onClick={onArchive}
              disabled={isSaving || isArchiving || onArchive === undefined}
            >
              {isArchiving ? 'Archiving…' : 'Archive'}
            </button>
          ) : null}
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
  const { retryDownload: retrySongDownload } = useGuestService()
  const {
    archiveSong,
    fetchSongbook,
    fixDuration,
    searchSongbook,
    updateSongAdminDetails,
  } = useAdminService()
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortKey, setSortKey] = useState<SongSortKey>('attention')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [previewSong, setPreviewSong] = useState<SongbookSong | null>(null)
  const [editingSong, setEditingSong] = useState<SongbookSong | null>(null)
  const [editingSongThumbnailDataUrl, setEditingSongThumbnailDataUrl] = useState<string | null>(null)
  const [isSavingSong, setIsSavingSong] = useState(false)
  const [archivingSongId, setArchivingSongId] = useState<string | null>(null)
  const [showTrimModal, setShowTrimModal] = useState(false)
  const [selectedSongForTrim, setSelectedSongForTrim] = useState<SongbookSong | null>(null)
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [downloadsSocketStatus, setDownloadsSocketStatus] = useState('Disconnected')
  const [retryingSongIds, setRetryingSongIds] = useState<string[]>([])
  const downloadsSocketRef = useRef<WebSocket | null>(null)
  const downloadsReconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectDownloadsRef = useRef(false)
  const downloadReconnectAttemptsRef = useRef(0)

  const loadSongs = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const payload =
        query.trim() === ''
          ? await fetchSongbook(page, pageSize)
          : await searchSongbook(query.trim(), page, pageSize)
      setSongs(payload.items)
      setPages(payload.pages)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load songbook')
    } finally {
      setIsLoading(false)
    }
  }, [fetchSongbook, page, pageSize, query, searchSongbook])

  useEffect(() => {
    void loadSongs()
  }, [loadSongs])

  useEffect(() => {
    setPage(1)
  }, [query, pageSize])

  const clearDownloadsReconnectTimer = useCallback(() => {
    if (downloadsReconnectTimerRef.current !== null) {
      window.clearTimeout(downloadsReconnectTimerRef.current)
      downloadsReconnectTimerRef.current = null
    }
  }, [])

  const closeDownloadsSocket = useCallback(() => {
    const socket = downloadsSocketRef.current
    downloadsSocketRef.current = null
    if (socket !== null) {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (!isDownloadsModalOpen) {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
      setDownloadsSocketStatus('Disconnected')
      return
    }

    shouldReconnectDownloadsRef.current = true
    downloadReconnectAttemptsRef.current = 0

    const scheduleReconnect = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }
      clearDownloadsReconnectTimer()
      const delaySeconds = Math.min(2 ** downloadReconnectAttemptsRef.current, 8)
      downloadReconnectAttemptsRef.current += 1
      setDownloadsSocketStatus(`Reconnecting in ${delaySeconds}s...`)
      downloadsReconnectTimerRef.current = window.setTimeout(() => {
        downloadsReconnectTimerRef.current = null
        connectSocket()
      }, delaySeconds * 1000)
    }

    const connectSocket = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }

      setDownloadsSocketStatus('Connecting...')
      const socket = new WebSocket(buildWSUrl('/ws/guest', {}))
      downloadsSocketRef.current = socket

      socket.onopen = () => {
        downloadReconnectAttemptsRef.current = 0
        setDownloadsSocketStatus('Connected')
      }

      socket.onclose = () => {
        if (!shouldReconnectDownloadsRef.current) {
          setDownloadsSocketStatus('Disconnected')
          return
        }
        scheduleReconnect()
      }

      socket.onerror = () => {
        setDownloadsSocketStatus('Connection error')
      }

      socket.onmessage = (event) => {
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }
        if (payload.type !== 'downloads.updated') {
          return
        }
        const incoming = normalizeDownloadProgressItems(payload.payload.items)
        setDownloadItems((previous) => mergeDownloadProgressItems(previous, incoming))
      }
    }

    connectSocket()
    return () => {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
    }
  }, [isDownloadsModalOpen, clearDownloadsReconnectTimer, closeDownloadsSocket])

  const attentionCount = useMemo(
    () => songs.filter((song) => song.qualityScore > 0).length,
    [songs],
  )
  const knownTagSuggestions = useMemo(
    () => normalizeTagList(songs.flatMap((song) => song.tags)),
    [songs],
  )
  const sortedSongs = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...songs].sort((left, right) => {
      if (sortKey === 'title') {
        return left.title.localeCompare(right.title) * direction
      }
      if (sortKey === 'status') {
        return getSongStatusLabel(left.status).localeCompare(getSongStatusLabel(right.status)) * direction
      }
      if (sortKey === 'added') {
        const leftTimestamp = Date.parse(left.addedAt)
        const rightTimestamp = Date.parse(right.addedAt)
        const safeLeft = Number.isNaN(leftTimestamp) ? 0 : leftTimestamp
        const safeRight = Number.isNaN(rightTimestamp) ? 0 : rightTimestamp
        return (safeLeft - safeRight) * direction
      }
      return ((left.qualityScore || 0) - (right.qualityScore || 0)) * direction
    })
  }, [songs, sortDirection, sortKey])

  const handleSort = useCallback((key: SongSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'attention' || key === 'added' ? 'desc' : 'asc')
  }, [sortKey])

  const handleRetryDownload = useCallback((songId: string) => {
    setRetryingSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
    void retrySongDownload(songId)
      .then(() => {
        setDownloadItems((items) =>
          items.map((item) =>
            item.songId === songId
              ? {
                  ...item,
                  status: 'pending',
                  progressPct: null,
                  progressMessage: 'Waiting in queue',
                  errorMessage: null,
                }
              : item,
          ),
        )
      })
      .finally(() => {
        setRetryingSongIds((current) => current.filter((entry) => entry !== songId))
      })
  }, [retrySongDownload])

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
        is_off_vocal: editingSong.isOffVocal,
        video_has_lyrics: editingSong.videoHasLyrics,
        source_thumbnail_data_url: editingSongThumbnailDataUrl,
      })
      setSongs((current) => current.map((song) => (song.id === updated.id ? updated : song)))
      setMessage('Song updated.')
      setEditingSong(null)
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
        if (editingSong?.id === song.id) {
          setEditingSong(null)
          setEditingSongThumbnailDataUrl(null)
        }
        await loadSongs()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to archive song')
      } finally {
        setArchivingSongId(null)
      }
    },
    [archiveSong, auth.accessToken, editingSong?.id, loadSongs],
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

  const handleMagicFixDuration = useCallback(async () => {
    if (editingSong === null || !editingSong.videoFile) {
      return
    }

    setIsSavingSong(true)
    setErrorMessage('')
    try {
      const payload = await fixDuration(editingSong.id, auth.accessToken)
      setEditingSong((current) => (current === null ? null : { ...current, duration: payload.new_duration }))
      setSongs((current) =>
        current.map((song) => (song.id === editingSong.id ? { ...song, duration: payload.new_duration } : song)),
      )
      if (previewSong?.id === editingSong.id) {
        setPreviewSong((current) => (current === null ? null : { ...current, duration: payload.new_duration }))
      }
      setMessage(payload.message || `Duration fixed: ${payload.old_duration} → ${payload.new_duration}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to fix duration')
    } finally {
      setIsSavingSong(false)
    }
  }, [auth.accessToken, editingSong, fixDuration, previewSong])

  return (
    <main className="app-shell admin-songbook-shell">
      <section className="card admin-songbook-card">
        <div className="card-header admin-songbook-header">
          <div className="admin-songbook-title-row">
            <button
              type="button"
              className="icon-control-button"
              onClick={() => navigate('/admin/dashboard')}
              title="Back to dashboard"
              aria-label="Back to dashboard"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1>Manage Songbook</h1>
          </div>
          <div className="row-actions admin-songbook-header-actions">
            <button
              type="button"
              className="icon-control-button"
              onClick={() => setIsDownloadsModalOpen(true)}
              title="Download Progress"
              aria-label="Download Progress"
            >
              <span className="material-symbols-outlined">download</span>
            </button>
            <button
              type="button"
              className="icon-control-button"
              onClick={() => navigate('/admin/songbook/suggest/search')}
              title="Suggest song"
              aria-label="Suggest song"
            >
              <span className="material-symbols-outlined">auto_awesome</span>
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
            <label className="admin-songbook-page-size">
              Items
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <button
              type="button"
              className="icon-control-button"
              onClick={() => setQuery('')}
              title="Clear search"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined" aria-hidden="true">backspace</span>
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
            <button type="button" className="admin-songbook-sort-button" onClick={() => handleSort('title')}>
              Song
            </button>
            <span>Metadata</span>
            <button type="button" className="admin-songbook-sort-button" onClick={() => handleSort('attention')}>
              Attention
            </button>
            <button type="button" className="admin-songbook-sort-button" onClick={() => handleSort('status')}>
              Status
            </button>
            <button type="button" className="admin-songbook-sort-button" onClick={() => handleSort('added')}>
              Added
            </button>
            <span>Actions</span>
          </div>

          {isLoading ? (
            <div className="top-gap">
              <SkeletonList count={3} />
            </div>
          ) : sortedSongs.length === 0 ? (
            <p className="empty-state top-gap">No songs found.</p>
          ) : (
            sortedSongs.map((song) => (
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

                  <div className="admin-songbook-status">
                    <span className={`badge admin-songbook-status-badge ${getSongStatusClass(song.status)}`}>
                      {getSongStatusLabel(song.status)}
                    </span>
                  </div>

                  <div className="admin-songbook-added">
                    <span className="session-meta">{formatAddedAt(song.addedAt)}</span>
                  </div>

                  <div className="row-actions admin-songbook-actions">
                    <button type="button" className="secondary" onClick={() => handleOpenEdit(song)}>
                      Edit Details
                    </button>
                  <button type="button" className="secondary" onClick={() => setPreviewSong(song)}>
                    View Details
                  </button>
                  {song.videoFile ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setSelectedSongForTrim(song)
                        setShowTrimModal(true)
                      }}
                    >
                      <span className="material-symbols-outlined">content_cut</span>
                      <span>Trim Video</span>
                    </button>
                  ) : null}
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
          onArchive={() => void handleArchiveSong(editingSong)}
          isArchiving={archivingSongId === editingSong.id}
          onMagicFixDuration={() => void handleMagicFixDuration()}
          tagSuggestions={knownTagSuggestions}
          onTrimClick={() => {
            setSelectedSongForTrim(editingSong)
            setShowTrimModal(true)
          }}
        />
      ) : null}

      <DownloadProgressModal
        isOpen={isDownloadsModalOpen}
        status={downloadsSocketStatus}
        items={downloadItems}
        retryingSongIds={retryingSongIds}
        onClose={() => setIsDownloadsModalOpen(false)}
        onRetryDownload={handleRetryDownload}
      />

      {showTrimModal && selectedSongForTrim ? (
        <SongTrimModal
          song={selectedSongForTrim}
          isOpen={showTrimModal}
          auth={auth}
          onClose={() => {
            setShowTrimModal(false)
            setSelectedSongForTrim(null)
          }}
          onTrimComplete={() => {
            setShowTrimModal(false)
            setSelectedSongForTrim(null)
            void loadSongs()
          }}
        />
      ) : null}
    </main>
  )
}
