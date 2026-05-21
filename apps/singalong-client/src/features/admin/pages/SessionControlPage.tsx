import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import QRCode from 'qrcode'
import { useNavigate, useParams } from 'react-router-dom'
import { useAdminService } from '../hooks/useAdminService'
import { useGuestService } from '../../guest/hooks/useGuestService'
import { fetchSongDetail } from '../services/adminService'
import { buildGuestJoinUrl } from '../../guest/services/guestService'
import {
  mergeDownloadProgressItems,
  normalizeDownloadProgressItems,
  normalizeSessionQueueItems,
} from '../../shared/services/queueTransforms'
import { apiJson } from '../../../shared/api/httpClient'
import { buildWSUrl } from '../../../shared/api/ws'
import { formatDownloadStatus, formatDurationClock } from '../../../shared/lib/format'
import { readFileAsDataUrl } from '../../../shared/lib/files'
import { splitChipInput } from '../../../shared/lib/suggest'
import { SongbookListItem } from '../../songbook/components/SongbookListItem'
import type {
  DownloadProgressItem,
  PlaybackState,
  SessionParticipant,
  SessionRecord,
  SessionWorkspace,
  SongbookSong,
  SongQueueItem,
  StoredAuth,
  WSIncoming,
} from '../../../shared/types/client'

type ReservationListItemProps = {
  item: SongQueueItem
  onClick?: () => void
  showPlayingIcon?: boolean
  showOutcome?: boolean
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  className?: string
}

function ReservationListItem({
  item,
  onClick,
  showPlayingIcon = false,
  showOutcome = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  className = '',
}: ReservationListItemProps) {
  const stoppedAt =
    typeof item.playbackPositionSeconds === 'number' && Number.isFinite(item.playbackPositionSeconds)
      ? formatDurationClock(item.playbackPositionSeconds)
      : null
  return (
    <article
      className={`queue-item reservation-item ${className}`.trim()}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      draggable={draggable}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {item.thumbnailUrl ? (
        <img className="songbook-thumbnail" src={item.thumbnailUrl} alt={item.title} loading="lazy" />
      ) : (
        <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
      )}
      <div className="songbook-info reservation-info">
        <div className="songbook-item-header">
          <strong>{item.title}</strong>
          {showPlayingIcon ? (
            <span className="material-symbols-outlined reservation-playing-icon" aria-hidden="true">
              graphic_eq
            </span>
          ) : null}
        </div>
        <p className="session-meta">
          {item.artist}
          {item.duration ? ` · ${item.duration}` : ''}
        </p>
        <p className="session-meta reservation-reserved-by">
          Reserved by {item.reservedByUsername ?? 'unknown'}
        </p>
        {showOutcome && (item.status === 'finished' || item.status === 'skipped') ? (
          <p className="session-meta reservation-outcome">
            <span className={`reservation-outcome-badge ${item.status}`}>
              {item.status === 'finished' ? 'Finished' : 'Skipped'}
            </span>
            {stoppedAt ? <span className="reservation-outcome-time">Stopped at {stoppedAt}</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function buildCompactPagination(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages = new Set<number>([1, 2, totalPages - 1, totalPages])
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = page + offset
    if (candidate >= 1 && candidate <= totalPages) {
      pages.add(candidate)
    }
  }

  const ordered = Array.from(pages).sort((left, right) => left - right)
  const items: Array<number | 'ellipsis'> = []
  ordered.forEach((value, index) => {
    const previous = ordered[index - 1]
    if (previous !== undefined && value - previous > 1) {
      items.push('ellipsis')
    }
    items.push(value)
  })
  return items
}

type DownloadProgressModalProps = {
  isOpen: boolean
  status: string
  items: DownloadProgressItem[]
  retryingSongIds: string[]
  onClose: () => void
  onRetryDownload: (songId: string) => void
}

function DownloadProgressModal({
  isOpen,
  status,
  items,
  retryingSongIds,
  onClose,
  onRetryDownload,
}: DownloadProgressModalProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        className="modal-card downloads-modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <h2>Download Progress</h2>
            <p className="subtitle">Status: {status}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="downloads-modal-list top-gap">
          {items.length === 0 ? (
            <p className="empty-state">No active downloads.</p>
          ) : (
            items.map((item) => {
              const isRetrying = retryingSongIds.includes(item.songId)
              const progressValue =
                item.progressPct !== null ? Math.max(0, Math.min(100, item.progressPct)) : 0
              const statusText =
                item.status === 'error'
                  ? item.errorMessage ?? 'Download failed'
                  : item.status === 'pending'
                    ? 'Waiting in queue'
                    : 'Downloading video'

              return (
                <article key={item.songId} className="downloads-progress-item">
                  {item.sourceThumbnail ? (
                    <img
                      className="downloads-progress-thumb"
                      src={item.sourceThumbnail}
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="downloads-progress-thumb downloads-progress-thumb--placeholder" />
                  )}
                  <div className="downloads-progress-content">
                    <strong>{item.title}</strong>
                    <p className="session-meta">
                      {item.artist}
                      {' · '}
                      {item.duration ?? '--:--'}
                    </p>
                    <p className="session-meta">{item.addedByUsername ?? '—'}</p>
                    <div className="downloads-progress-row">
                      <div className="downloads-progress-bar-group">
                        <progress
                          className="downloads-progress-bar"
                          max={100}
                          value={progressValue}
                        />
                        <span className="downloads-progress-pct">{progressValue}%</span>
                      </div>
                      <span className={`badge download-status-badge ${item.status}`}>
                        {formatDownloadStatus(item.status)}
                      </span>
                    </div>
                    <p className="session-meta">{statusText}</p>
                    {item.status === 'error' ? (
                      <div className="downloads-actions">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => onRetryDownload(item.songId)}
                          disabled={isRetrying}
                        >
                          {isRetrying ? 'Retrying…' : 'Retry'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

type SessionControlPageProps = {
  auth: StoredAuth
  sessions: SessionRecord[]
  onRefreshSessions: () => void
  onArchiveSession: (sessionId: string) => void
}

export function SessionControlPage({
  auth,
  sessions,
  onRefreshSessions,
  onArchiveSession,
}: SessionControlPageProps) {
  const navigate = useNavigate()
  const {
    fetchSessionParticipants,
    fetchSessionQueue,
    fetchSessionWorkspace,
    fetchSongbook,
    searchSongbook,
    reserveSessionQueueSong,
    updateSessionMetadata,
    updateSongAdminDetails,
  } = useAdminService()
  const { retryDownload: retrySongDownload } = useGuestService()
  const params = useParams<{ sessionCode: string }>()
  const sessionCode = params.sessionCode ?? ''
  const [socketStatus, setSocketStatus] = useState('Connecting...')
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>([])
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [retryingDownloadSongIds, setRetryingDownloadSongIds] = useState<string[]>([])
  const [songbookItems, setSongbookItems] = useState<SongbookSong[]>([])
  const [songbookQuery, setSongbookQuery] = useState('')
  const [songbookPage, setSongbookPage] = useState(1)
  const [songbookPages, setSongbookPages] = useState(1)
  const [isSavingSessionMeta, setIsSavingSessionMeta] = useState(false)
  const [isSavingSongMeta, setIsSavingSongMeta] = useState(false)
  const [volumePct, setVolumePct] = useState(70)
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    positionSeconds: 0,
    durationSeconds: 0,
  })
  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null)
  const [participants, setParticipants] = useState<SessionParticipant[]>([])
  const [sessionTitleInput, setSessionTitleInput] = useState('')
  const [vibesInput, setVibesInput] = useState('')
  const [isSessionEditorOpen, setIsSessionEditorOpen] = useState(false)
  const [mobileRightPanel, setMobileRightPanel] = useState<'songbook' | 'participants' | null>(null)
  const [activeSongMenuId, setActiveSongMenuId] = useState<string | null>(null)
  const [isReservationsHistoryOpen, setIsReservationsHistoryOpen] = useState(false)
  const [isReservationsReorderOpen, setIsReservationsReorderOpen] = useState(false)
  const [reservationReorderDraft, setReservationReorderDraft] = useState<SongQueueItem[]>([])
  const [reservationDragSongId, setReservationDragSongId] = useState<string | null>(null)
  const [isSavingReservationOrder, setIsSavingReservationOrder] = useState(false)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [guestJoinQrDataUrl, setGuestJoinQrDataUrl] = useState<string | null>(null)
  const [isGeneratingGuestQr, setIsGeneratingGuestQr] = useState(false)
  const [editingSong, setEditingSong] = useState<SongbookSong | null>(null)
  const [editingSongThumbnailDataUrl, setEditingSongThumbnailDataUrl] = useState<string | null>(null)
  const [, setWsMessage] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const shouldReconnectRef = useRef(true)
  const refreshSessionsRef = useRef(onRefreshSessions)
  const lastNonZeroVolumeRef = useRef(70)

  const session = useMemo(
    () =>
      sessions.find(
        (entry) =>
          entry.session_code === sessionCode && entry.archived_at === null,
      ) ?? null,
    [sessionCode, sessions],
  )
  const activeSessionCode = session?.session_code ?? null
  const activeSessionId = session?.id ?? null
  const guestJoinUrl = useMemo(
    () => buildGuestJoinUrl(window.location.origin, activeSessionId),
    [activeSessionId],
  )

  useEffect(() => {
    refreshSessionsRef.current = onRefreshSessions
  }, [onRefreshSessions])

  const sendCommand = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const socket = socketRef.current
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      setWsMessage('WebSocket is not connected.')
      return
    }

    socket.send(
      JSON.stringify({
        type,
        session_code: sessionCode,
        payload,
      }),
    )
  }, [sessionCode])

  const refreshWorkspace = useCallback(async () => {
    if (activeSessionCode === null) {
      return
    }
    try {
      const payload = await fetchSessionWorkspace(activeSessionCode, auth.accessToken)
      setWorkspace(payload)
      setSessionTitleInput(payload.session.name)
      setVibesInput(payload.session.vibes ?? '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workspace metadata'
      setWsMessage(message)
    }
  }, [activeSessionCode, auth.accessToken])

  const refreshParticipants = useCallback(async () => {
    if (activeSessionCode === null) {
      return
    }
    try {
      const payload = await fetchSessionParticipants(activeSessionCode, auth.accessToken)
      setParticipants(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load participants'
      setWsMessage(message)
    }
  }, [activeSessionCode, auth.accessToken])

  const refreshQueue = useCallback(async () => {
    if (activeSessionCode === null) {
      return
    }
    try {
      const items = await fetchSessionQueue(activeSessionCode, auth.accessToken)
      setQueueItems(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load session queue'
      setWsMessage(message)
    }
  }, [activeSessionCode, auth.accessToken])

  const loadSongbook = useCallback(async () => {
    if (activeSessionCode === null || activeSessionId === null) {
      return
    }
    try {
      const response =
        songbookQuery.trim() === ''
          ? await fetchSongbook(songbookPage, 10, undefined, activeSessionId)
          : await searchSongbook(songbookQuery.trim(), songbookPage, 10, undefined, activeSessionId)
      setSongbookItems(response.items)
      setSongbookPages(response.pages)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load songbook'
      setWsMessage(message)
    }
  }, [activeSessionCode, activeSessionId, songbookPage, songbookQuery])

  useEffect(() => {
    if (activeSessionCode === null) {
      return
    }
    void refreshQueue()
    void loadSongbook()
    void refreshWorkspace()
    void refreshParticipants()
  }, [activeSessionCode, refreshQueue, loadSongbook, refreshWorkspace, refreshParticipants])

  const handleReserveSong = useCallback(async (songId: string) => {
    if (activeSessionCode === null || songId === '') {
      return
    }
    setWsMessage('')
    try {
      await reserveSessionQueueSong(activeSessionCode, songId, auth.accessToken)
      await refreshQueue()
      await loadSongbook()
      await refreshParticipants()
      setWsMessage('Song reserved.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reserve song'
      setWsMessage(message)
    }
  }, [activeSessionCode, auth.accessToken, loadSongbook, refreshParticipants, refreshQueue])

  const handleSaveSessionVibes = useCallback(async () => {
    if (session === null) {
      return
    }
    setIsSavingSessionMeta(true)
    try {
      const updated = await updateSessionMetadata(session.id, auth.accessToken, {
        name: sessionTitleInput,
        vibes: vibesInput,
      })
      setWorkspace((previous) => (previous === null ? previous : { ...previous, session: updated }))
      setSessionTitleInput(updated.name)
      setVibesInput(updated.vibes ?? '')
      setWsMessage('Session updated.')
      setIsSessionEditorOpen(false)
      onRefreshSessions()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update session vibes'
      setWsMessage(message)
    } finally {
      setIsSavingSessionMeta(false)
    }
  }, [auth.accessToken, onRefreshSessions, session, sessionTitleInput, vibesInput])

  const handleOpenSongEditor = useCallback(async (songId: string) => {
    if (activeSessionCode === null || activeSessionId === null) {
      return
    }
    setActiveSongMenuId(null)
    try {
      const detail = await fetchSongDetail(songId, undefined, activeSessionId)
      setEditingSong(detail)
      setEditingSongThumbnailDataUrl(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load song details'
      setWsMessage(message)
    }
  }, [activeSessionCode, activeSessionId])

  const handleSaveSongEditor = useCallback(async () => {
    if (editingSong === null) {
      return
    }
    setIsSavingSongMeta(true)
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
      await loadSongbook()
      setWsMessage('Song metadata updated.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update song metadata'
      setWsMessage(message)
    } finally {
      setIsSavingSongMeta(false)
    }
  }, [auth.accessToken, editingSong, editingSongThumbnailDataUrl, loadSongbook])

  const handleRetryDownload = useCallback((songId: string) => {
    setRetryingDownloadSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
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
        setRetryingDownloadSongIds((current) => current.filter((entry) => entry !== songId))
      })
  }, [])

  const pendingQueueItems = useMemo(
    () =>
      queueItems
        .filter((item) => item.status === 'playing' || item.status === 'pending')
        .sort((a, b) => a.queueOrder - b.queueOrder),
    [queueItems],
  )
  const historyQueueItems = useMemo(
    () =>
      queueItems
        .filter((item) => item.status !== 'playing' && item.status !== 'pending')
        .sort((a, b) => {
          const left = a.playedAt ?? a.reservedAt
          const right = b.playedAt ?? b.reservedAt
          return new Date(right).getTime() - new Date(left).getTime()
        }),
    [queueItems],
  )
  const currentQueueSong = pendingQueueItems[0] ?? null

  useEffect(() => {
    if (currentQueueSong === null) {
      return
    }
    if (typeof currentQueueSong.playbackVolumePct === 'number' && Number.isFinite(currentQueueSong.playbackVolumePct)) {
      const nextVolume = Math.max(0, Math.min(100, Math.round(currentQueueSong.playbackVolumePct)))
      setVolumePct(nextVolume)
      if (nextVolume > 0) {
        lastNonZeroVolumeRef.current = nextVolume
      }
    }
    if (
      typeof currentQueueSong.playbackPositionSeconds === 'number' &&
      Number.isFinite(currentQueueSong.playbackPositionSeconds)
    ) {
      setPlaybackState((previous) => ({
        ...previous,
        positionSeconds: Math.max(0, currentQueueSong.playbackPositionSeconds ?? 0),
      }))
    }
    if (typeof currentQueueSong.playbackIsPlaying === 'boolean') {
      setPlaybackState((previous) => ({
        ...previous,
        isPlaying: currentQueueSong.playbackIsPlaying ?? previous.isPlaying,
      }))
    }
  }, [currentQueueSong])

  const closeSongEditor = useCallback(() => {
    if (isSavingSongMeta) {
      return
    }
    setEditingSong(null)
  }, [isSavingSongMeta])

  const activeSongMenu = useMemo(
    () => songbookItems.find((song) => song.id === activeSongMenuId) ?? null,
    [activeSongMenuId, songbookItems],
  )

  useEffect(() => {
    if (activeSongMenuId !== null && activeSongMenu === null) {
      setActiveSongMenuId(null)
    }
  }, [activeSongMenu, activeSongMenuId])

  useEffect(() => {
    if (guestJoinUrl === '') {
      setGuestJoinQrDataUrl(null)
      setIsGeneratingGuestQr(false)
      return
    }

    let isCancelled = false
    setIsGeneratingGuestQr(true)
    void QRCode.toDataURL(guestJoinUrl, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!isCancelled) {
          setGuestJoinQrDataUrl(url)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setGuestJoinQrDataUrl(null)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsGeneratingGuestQr(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [guestJoinUrl])

  const openReservationsReorderModal = useCallback(() => {
    setReservationReorderDraft(pendingQueueItems.slice(1))
    setReservationDragSongId(null)
    setIsReservationsReorderOpen(true)
  }, [pendingQueueItems])

  const closeReservationsReorderModal = useCallback(() => {
    if (isSavingReservationOrder) {
      return
    }
    setIsReservationsReorderOpen(false)
    setReservationDragSongId(null)
  }, [isSavingReservationOrder])

  const saveReservationsReorder = useCallback(async () => {
    if (activeSessionCode === null) {
      return
    }

    setIsSavingReservationOrder(true)
    try {
      for (let index = 0; index < reservationReorderDraft.length; index += 1) {
        const item = reservationReorderDraft[index]
        await apiJson<{ message: string }>(`/sessions/${activeSessionCode}/queue/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'reorder',
            target_order: index + 2,
          }),
        }, auth.accessToken)
      }
      await refreshQueue()
      setIsReservationsReorderOpen(false)
      setReservationDragSongId(null)
      setWsMessage('Reservation order updated.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reservation order'
      setWsMessage(message)
    } finally {
      setIsSavingReservationOrder(false)
    }
  }, [activeSessionCode, auth.accessToken, refreshQueue, reservationReorderDraft])

  const handleReservationDragStart = useCallback((songId: string) => {
    setReservationDragSongId(songId)
  }, [])

  const handleReservationDrop = useCallback((targetSongId: string) => {
    setReservationReorderDraft((current) => {
      const sourceIndex = current.findIndex((item) => item.songId === reservationDragSongId)
      const targetIndex = current.findIndex((item) => item.songId === targetSongId)
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
    setReservationDragSongId(null)
  }, [reservationDragSongId])

  const closeReservationsHistoryModal = useCallback(() => {
    setIsReservationsHistoryOpen(false)
  }, [])

  const handleCopyGuestJoinUrl = useCallback(() => {
    if (guestJoinUrl === '') {
      return
    }
    void navigator.clipboard.writeText(guestJoinUrl)
  }, [guestJoinUrl])

  useEffect(() => {
    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const closeSocket = () => {
      const currentSocket = socketRef.current
      if (currentSocket !== null) {
        currentSocket.onopen = null
        currentSocket.onclose = null
        currentSocket.onerror = null
        currentSocket.onmessage = null
        currentSocket.close()
        socketRef.current = null
      }
    }

    if (activeSessionCode === null) {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
      setSocketStatus('Session not found or inactive.')
      return
    }

    shouldReconnectRef.current = true
    reconnectAttemptRef.current = 0

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) {
        return
      }
      clearReconnectTimer()
      const delaySeconds = Math.min(2 ** reconnectAttemptRef.current, 8)
      reconnectAttemptRef.current += 1
      setSocketStatus(`Disconnected. Reconnecting in ${delaySeconds}s...`)
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connectSocket()
      }, delaySeconds * 1000)
    }

    const connectSocket = () => {
      if (!shouldReconnectRef.current) {
        return
      }

      const wsUrl = buildWSUrl('/ws/admin', {
        session_code: activeSessionCode,
        token: auth.accessToken,
      })
      setSocketStatus('Connecting...')
      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setSocketStatus('Connected')
        setWsMessage('')
      }

      socket.onclose = () => {
        if (!shouldReconnectRef.current) {
          setSocketStatus('Disconnected')
          return
        }
        scheduleReconnect()
      }

      socket.onerror = () => {
        setSocketStatus('Connection error')
      }

      socket.onmessage = (event) => {
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }

        if (payload.type === 'queue.updated') {
          const items = payload.payload.items
          setQueueItems(normalizeSessionQueueItems(items))
          void refreshParticipants()
          void loadSongbook()
          return
        }

        if (payload.type === 'downloads.updated') {
          const items = payload.payload.items
          if (Array.isArray(items)) {
            setDownloadItems((previous) =>
              mergeDownloadProgressItems(previous, normalizeDownloadProgressItems(items)),
            )
          }
          return
        }

        if (payload.type === 'playback.position') {
          const nextPosition = Number(payload.payload.position_seconds ?? 0)
          const nextDuration = Number(payload.payload.duration_seconds ?? 0)
          setPlaybackState((previous) => ({
            ...previous,
            positionSeconds: Number.isFinite(nextPosition) ? nextPosition : previous.positionSeconds,
            durationSeconds: Number.isFinite(nextDuration) ? nextDuration : previous.durationSeconds,
          }))
          return
        }

        if (payload.type === 'playback.ended') {
          setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
          setWsMessage('Player reported playback ended.')
          return
        }

        if (payload.type === 'session.ended') {
          shouldReconnectRef.current = false
          clearReconnectTimer()
          closeSocket()
          setWsMessage('Session ended. Returning to sessions.')
          refreshSessionsRef.current()
          window.setTimeout(() => navigate('/admin/sessions'), 500)
          return
        }

        if (payload.type === 'error') {
          const message = payload.payload.message
          if (typeof message === 'string') {
            setWsMessage(message)
          }
        }
      }
    }

    connectSocket()

    return () => {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
    }
  }, [activeSessionCode, auth.accessToken, loadSongbook, navigate, refreshParticipants])

  if (session === null) {
    return (
      <main className="app-shell">
        <section className="card">
          <h1>Session Control</h1>
          <p className="error-message">Session not found or inactive.</p>
          <button type="button" className="secondary" onClick={() => navigate('/admin/sessions')}>
            Back to sessions
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell admin-session-shell">
      <section className="card session-control-card session-workspace">
        <div className="workspace-column workspace-column-left">
          <section className="panel workspace-panel playback-panel">
            <div className="panel-header playback-panel-header">
              <div className="playback-title-row">
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => navigate('/admin/sessions')}
                  title="Back to sessions"
                  aria-label="Back to sessions"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                </button>
                <h2 className="session-heading">
                  {(workspace?.session.name ?? session.name) + ' \u2014 ' + session.session_code}
                </h2>
              </div>
              <div className="row-actions">
                <button type="button" className="secondary small mobile-only" onClick={() => setMobileRightPanel('songbook')}>
                  Open Songbook
                </button>
                <button type="button" className="secondary small mobile-only" onClick={() => setMobileRightPanel('participants')}>
                  Open Participants
                </button>
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => setIsSessionEditorOpen(true)}
                  title="Edit session"
                  aria-label="Edit session"
                >
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => setIsQrModalOpen(true)}
                  title="Guest join QR"
                  aria-label="Guest join QR"
                >
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                </button>
              </div>
            </div>
            <p className="subtitle">
              WebSocket: {socketStatus} · Player: {workspace?.playerConnected ? 'Connected' : 'Disconnected'}
            </p>
            {currentQueueSong ? (
              <p className="session-meta">
                Now queued next: <strong>{currentQueueSong.title}</strong> · {currentQueueSong.artist}
              </p>
            ) : (
              <p className="session-meta">No pending songs in queue.</p>
            )}
            <div className="playback-actions compact">
              <button
                type="button"
                className="icon-control-button"
                onClick={() => {
                  if (playbackState.isPlaying) {
                    setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
                    sendCommand('playback.pause')
                    return
                  }
                  setPlaybackState((previous) => ({ ...previous, isPlaying: true }))
                  sendCommand('playback.play')
                }}
                title={playbackState.isPlaying ? 'Pause' : 'Play'}
                aria-label={playbackState.isPlaying ? 'Pause' : 'Play'}
              >
                <span className="material-symbols-outlined">
                  {playbackState.isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </button>
              <button
                type="button"
                className="icon-control-button"
                onClick={() => {
                  setPlaybackState((previous) => ({ ...previous, positionSeconds: 0 }))
                  sendCommand('playback.skip')
                }}
                title="Next / Skip"
                aria-label="Next / Skip"
              >
                <span className="material-symbols-outlined">skip_next</span>
              </button>
            </div>
            <div className="top-gap">
              <div className="playback-seek-row">
                <span className="playback-duration-label">{formatDurationClock(playbackState.positionSeconds)}</span>
                <input
                  className="playback-seek"
                  type="range"
                  min={0}
                  max={playbackState.durationSeconds > 0 ? playbackState.durationSeconds : 100}
                  step={0.1}
                  value={Math.min(
                    playbackState.durationSeconds > 0 ? playbackState.durationSeconds : 100,
                    Math.max(0, playbackState.positionSeconds),
                  )}
                  style={
                    {
                      '--range-progress': `${
                        playbackState.durationSeconds > 0
                          ? Math.min(100, Math.max(0, (playbackState.positionSeconds / playbackState.durationSeconds) * 100))
                          : Math.min(100, Math.max(0, playbackState.positionSeconds))
                      }%`,
                    } as CSSProperties
                  }
                  onChange={(event) => {
                    const nextPosition = Number(event.target.value)
                    setPlaybackState((previous) => ({ ...previous, positionSeconds: nextPosition }))
                    sendCommand('playback.seek', { position_seconds: nextPosition })
                  }}
                />
                <span className="playback-duration-label">
                  {formatDurationClock(playbackState.durationSeconds)}
                </span>
              </div>
            </div>
            <div className="volume-row top-gap">
              <button
                type="button"
                className="icon-control-button"
                onClick={() => {
                  if (volumePct === 0) {
                    const restoredVolume = Math.max(1, Math.min(100, lastNonZeroVolumeRef.current))
                    setVolumePct(restoredVolume)
                    sendCommand('playback.volume', { volume_pct: restoredVolume })
                    return
                  }
                  lastNonZeroVolumeRef.current = volumePct
                  setVolumePct(0)
                  sendCommand('playback.volume', { volume_pct: 0 })
                }}
                title={volumePct === 0 ? 'Unmute' : 'Mute'}
                aria-label={volumePct === 0 ? 'Unmute' : 'Mute'}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {volumePct === 0 ? 'volume_off' : 'volume_up'}
                </span>
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volumePct}
                style={{ '--range-progress': `${Math.min(100, Math.max(0, volumePct))}%` } as CSSProperties}
                onChange={(event) => {
                  const nextVolume = Math.max(0, Math.min(100, Number(event.target.value)))
                  setVolumePct(nextVolume)
                  if (nextVolume > 0) {
                    lastNonZeroVolumeRef.current = nextVolume
                  }
                  sendCommand('playback.volume', { volume_pct: nextVolume })
                }}
                aria-label="Volume"
              />
            </div>
          </section>

          <section className="panel workspace-panel queue-panel">
            <div className="panel-header queue-panel-header">
              <h2>Reservations</h2>
              <div className="row-actions">
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={openReservationsReorderModal}
                  title="Re-arrange"
                  aria-label="Re-arrange reservations"
                  disabled={pendingQueueItems.length <= 1}
                >
                  <span className="material-symbols-outlined">swap_vert</span>
                </button>
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => setIsReservationsHistoryOpen(true)}
                  title="History"
                  aria-label="Open reservation history"
                >
                  <span className="material-symbols-outlined">history</span>
                </button>
              </div>
            </div>
            <div className="queue-body">
              <div className="queue-scrollframe">
                <div className="queue-list reservations-list">
                  {pendingQueueItems.length === 0 ? (
                    <p className="empty-state">No reservations yet.</p>
                  ) : (
                    pendingQueueItems.map((song, index) => (
                      <ReservationListItem
                        key={song.id}
                        item={song}
                        showPlayingIcon={index === 0}
                        onClick={() => void handleOpenSongEditor(song.songId)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="workspace-column workspace-column-right">
          <section className={`panel workspace-panel songbook-panel ${mobileRightPanel === 'songbook' ? 'mobile-visible mobile-right-panel-open' : 'mobile-hidden'}`}>
            <div className="panel-header songbook-panel-header">
              <div className="songbook-header-row">
                <input
                  className="songbook-search-input"
                  value={songbookQuery}
                  onChange={(event) => {
                    setSongbookQuery(event.target.value)
                    setSongbookPage(1)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void loadSongbook()
                    }
                  }}
                  placeholder="Search songs..."
                />
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => setIsDownloadsModalOpen(true)}
                  title="Downloads"
                  aria-label="Downloads"
                >
                  <span className="material-symbols-outlined">download</span>
                </button>
                <button
                  type="button"
                  className="icon-control-button"
                  onClick={() => navigate('/songbook/suggest/search')}
                  title="Suggest a song"
                  aria-label="Suggest a song"
                >
                  <span className="material-symbols-outlined">auto_awesome</span>
                </button>
                <button type="button" className="secondary small mobile-only" onClick={() => setMobileRightPanel(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="songbook-body">
              <div className="songbook-scrollframe">
                <div className="queue-list songbook-list">
                  {songbookItems.map((song) => (
                    <SongbookListItem
                      key={song.id}
                      song={song}
                      onClick={() => {
                        setActiveSongMenuId((current) => (current === song.id ? null : song.id))
                      }}
                      isMenuOpen={activeSongMenuId === song.id}
                      onMenuOpenChange={(open) => {
                        setActiveSongMenuId(open ? song.id : null)
                      }}
                      onReserve={() => {
                        setActiveSongMenuId(null)
                        void handleReserveSong(song.id)
                      }}
                      onEditDetails={() => void handleOpenSongEditor(song.id)}
                      badge={
                        song.wasQueuedInSession ? (
                          Math.max(song.queuedCountInSession, 1) === 1 ? (
                            <span className="songbook-played-indicator one" aria-label="Played once">
                              <span className="material-symbols-outlined" aria-hidden="true">
                                check_circle
                              </span>
                            </span>
                          ) : (
                            <span className="songbook-played-indicator many" aria-label="Played multiple times">
                              {Math.max(song.queuedCountInSession, 1)}
                            </span>
                          )
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
            {songbookPages > 1 ? (
              <div className="pagination songbook-pagination">
                <button
                  type="button"
                  className="icon-control-button pagination-arrow-button"
                  disabled={songbookPage <= 1}
                  onClick={() => setSongbookPage((current) => Math.max(1, current - 1))}
                  title="Previous page"
                  aria-label="Previous page"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <div className="pagination-pages">
                  {buildCompactPagination(songbookPage, songbookPages).map((item, index) =>
                    item === 'ellipsis' ? (
                      <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={`pagination-page-button ${item === songbookPage ? 'active' : ''}`}
                        onClick={() => setSongbookPage(item)}
                        aria-current={item === songbookPage ? 'page' : undefined}
                      >
                        {item}
                      </button>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  className="icon-control-button pagination-arrow-button"
                  disabled={songbookPage >= songbookPages}
                  onClick={() => setSongbookPage((current) => Math.min(songbookPages, current + 1))}
                  title="Next page"
                  aria-label="Next page"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
            ) : null}
          </section>

          <section className={`panel workspace-panel participants-panel ${mobileRightPanel === 'participants' ? 'mobile-visible mobile-right-panel-open' : 'mobile-hidden'}`}>
          <div className="panel-header">
            <h2>Participants</h2>
            <div className="row-actions">
              <button type="button" className="secondary small" onClick={() => void refreshParticipants()}>
                Refresh
              </button>
              <button type="button" className="secondary small mobile-only" onClick={() => setMobileRightPanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="queue-list top-gap">
            {participants.length === 0 ? (
              <p className="empty-state">No participants with queued songs yet.</p>
            ) : (
              participants.map((participant) => (
                <article key={participant.userId} className="queue-item">
                  <div className="panel-header">
                    <strong>{participant.username}</strong>
                    <span className={`badge ${participant.isOnline ? 'active' : 'inactive'}`}>
                      {participant.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <p className="session-meta">
                    Pending: {participant.pendingCount} · Finished: {participant.finishedCount} · Skipped: {participant.skippedCount} · Total: {participant.totalCount}
                  </p>
                </article>
              ))
            )}
          </div>
          </section>
        </div>
        <DownloadProgressModal
          isOpen={isDownloadsModalOpen}
          status={socketStatus}
          items={downloadItems}
          retryingSongIds={retryingDownloadSongIds}
          onClose={() => setIsDownloadsModalOpen(false)}
          onRetryDownload={handleRetryDownload}
        />
      </section>

      {isQrModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsQrModalOpen(false)}>
          <section
            className="modal-card guest-qr-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Guest join QR"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Guest Join QR</h2>
                <p className="subtitle">Scan to open the guest join page for this session.</p>
              </div>
              <button type="button" className="secondary" onClick={() => setIsQrModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="guest-qr-modal-content top-gap">
              <div className="guest-qr-code-shell">
                {isGeneratingGuestQr ? (
                  <p className="empty-state">Generating QR...</p>
                ) : guestJoinQrDataUrl ? (
                  <img src={guestJoinQrDataUrl} alt="Guest join QR code" />
                ) : (
                  <p className="empty-state">QR is unavailable.</p>
                )}
              </div>
              <p className="guest-qr-url">{guestJoinUrl !== '' ? guestJoinUrl : 'Join URL unavailable'}</p>
              <div className="row-actions">
                <button type="button" onClick={handleCopyGuestJoinUrl} disabled={guestJoinUrl === ''}>
                  Copy Link
                </button>
              </div>
              <p className="subtitle">Guests can share this link with other attendees. Guest flow improvements will follow in a later phase.</p>
            </div>
          </section>
        </div>
      ) : null}

      {isReservationsReorderOpen ? (
        <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={closeReservationsReorderModal}>
          <section
            className="modal-card reservations-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Re-arrange reservations"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Re-arrange Reservations</h2>
                <p className="subtitle">Drag the upcoming songs into the order you want next.</p>
              </div>
              <button type="button" className="secondary" onClick={closeReservationsReorderModal} disabled={isSavingReservationOrder}>
                Close
              </button>
            </div>
            <div className="queue-body top-gap">
              <div className="queue-scrollframe">
                <div className="queue-list reservation-reorder-list">
                  {reservationReorderDraft.length === 0 ? (
                    <p className="empty-state">Nothing to re-arrange after the current song.</p>
                  ) : (
                    reservationReorderDraft.map((item) => (
                      <ReservationListItem
                        key={item.id}
                        item={item}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', item.songId)
                          handleReservationDragStart(item.songId)
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          handleReservationDrop(item.songId)
                        }}
                        className={reservationDragSongId === item.songId ? 'is-dragging' : ''}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="row-actions top-gap">
              <button type="button" onClick={() => void saveReservationsReorder()} disabled={isSavingReservationOrder || reservationReorderDraft.length === 0}>
                {isSavingReservationOrder ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isReservationsHistoryOpen ? (
        <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={closeReservationsHistoryModal}>
          <section
            className="modal-card reservations-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Reservation history"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Reservation History</h2>
                <p className="subtitle">Previously played songs in this session.</p>
              </div>
              <button type="button" className="secondary" onClick={closeReservationsHistoryModal}>
                Close
              </button>
            </div>
            <div className="queue-body top-gap">
              <div className="queue-scrollframe">
                <div className="queue-list reservations-list">
                  {historyQueueItems.length === 0 ? (
                    <p className="empty-state">No history yet.</p>
                  ) : (
                    historyQueueItems.map((item) => (
                      <ReservationListItem
                        key={item.id}
                        item={item}
                        showOutcome
                        onClick={() => void handleOpenSongEditor(item.songId)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isSessionEditorOpen ? (
      <div className="modal-backdrop" role="presentation" onClick={() => setIsSessionEditorOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Session Editor</h2>
              <button
                type="button"
                className="secondary"
                disabled={isSavingSessionMeta}
                onClick={() => setIsSessionEditorOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="form top-gap">
              <label>
                Session Title
                <input
                  value={sessionTitleInput}
                  onChange={(event) => setSessionTitleInput(event.target.value)}
                  placeholder="Friday Night"
                />
              </label>
              <label>
                Session Vibes
                <input
                  value={vibesInput}
                  onChange={(event) => setVibesInput(event.target.value)}
                  placeholder="anime, high-energy, nostalgic"
                />
              </label>
            </div>
            <div className="row-actions top-gap">
              <button type="button" disabled={isSavingSessionMeta} onClick={() => void handleSaveSessionVibes()}>
                {isSavingSessionMeta ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={() => onArchiveSession(session.id)} disabled={isSavingSessionMeta}>
                End Session
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingSong !== null ? (
        <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={closeSongEditor}>
          <section
            className="modal-card song-detail-modal song-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingSong.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Edit Song Details</h2>
                <p className="subtitle">{editingSong.artist}</p>
              </div>
              <button type="button" className="secondary" onClick={closeSongEditor} disabled={isSavingSongMeta}>
                Close
              </button>
            </div>

            <div className="song-detail-layout song-editor-layout">
              <div className="song-detail-video-panel">
                {editingSong.videoFile ? (
                  <video
                    controls
                    className="song-detail-video"
                    src={`/media/songs/${editingSong.videoFile}`}
                  />
                ) : (
                  <p className="empty-state">Video not available.</p>
                )}
              </div>

              <div className="song-detail-panels song-editor-panels">
                <div className="song-detail-summary-panel">
                  <div className="song-detail-header-row song-editor-header-row">
                    {editingSong.thumbnailUrl ? (
                      <img
                        className="song-detail-thumbnail song-detail-thumbnail--small"
                        src={editingSong.thumbnailUrl}
                        alt={editingSong.title}
                      />
                    ) : (
                      <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                    )}

                    <div className="song-detail-meta song-editor-meta">
                      <input
                        className="song-editor-input song-editor-input--title"
                        value={editingSong.title}
                        onChange={(event) => setEditingSong({ ...editingSong, title: event.target.value })}
                        placeholder="Title"
                        aria-label="Title"
                      />
                      <input
                        className="song-editor-input song-editor-input--artist"
                        value={editingSong.artist}
                        onChange={(event) => setEditingSong({ ...editingSong, artist: event.target.value })}
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
                        value={editingSong.language ?? ''}
                        onChange={(event) => setEditingSong({ ...editingSong, language: event.target.value || null })}
                        placeholder="Language"
                      />
                    </label>
                    <label>
                      Genre
                      <input
                        className="song-editor-input"
                        value={editingSong.genre ?? ''}
                        onChange={(event) => setEditingSong({ ...editingSong, genre: event.target.value || null })}
                        placeholder="Genre"
                      />
                    </label>
                    <label className="song-editor-meta-grid-wide">
                      Tags (comma-separated)
                      <input
                        className="song-editor-input"
                        value={editingSong.tags.join(', ')}
                        onChange={(event) => setEditingSong({ ...editingSong, tags: splitChipInput(event.target.value) })}
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
                          void readFileAsDataUrl(file).then((dataUrl) => setEditingSongThumbnailDataUrl(dataUrl))
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="song-detail-lyrics-panel">
                  <h3>Lyrics</h3>
                  <textarea
                    value={editingSong.lyrics ?? ''}
                    onChange={(event) => setEditingSong({ ...editingSong, lyrics: event.target.value || null })}
                    placeholder="Lyrics"
                  />
                </div>
              </div>
            </div>

            <div className="row-actions top-gap">
              <button type="button" onClick={() => void handleSaveSongEditor()} disabled={isSavingSongMeta}>
                {isSavingSongMeta ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
