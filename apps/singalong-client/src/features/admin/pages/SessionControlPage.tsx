import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import QRCode from 'qrcode'
import { useNavigate, useParams } from 'react-router-dom'
import { useAdminService } from '../hooks/useAdminService'
import { fetchSongDetail } from '../services/adminService'
import { SongEditModal } from './AdminSongbookPage'
import { ReservationListItem } from '../../shared/components/ReservationListItem'
import {
  AdminSessionSuggestSearchRoute,
  AdminSessionSuggestUpdateRoute,
} from './AdminSessionSuggestPages'
import { buildGuestJoinUrl } from '../../guest/services/guestService'
import {
  mergeDownloadProgressItems,
  normalizeDownloadProgressItems,
  normalizeSessionQueueItems,
} from '../../shared/services/queueTransforms'
import { apiJson } from '../../../shared/api/httpClient'
import { buildWSUrl } from '../../../shared/api/ws'
import { fetchGuestBaseUrl } from '../../../shared/api/publicConfig'
import { formatDurationClock } from '../../../shared/lib/format'
import { DownloadProgressModal } from '../../songbook/components/DownloadProgressModal'
import { SongbookListItem } from '../../songbook/components/SongbookListItem'
import { SongDetailsModal } from '../../songbook/components/SongDetailsModal'
import type {
  DownloadProgressItem,
  PlaybackState,
  SessionParticipant,
  SessionRecord,
  SessionWorkspace,
  SongbookSong,
  SongQueueItem,
  StoredAuth,
  SuggestDraft,
  WSIncoming,
} from '../../../shared/types/client'

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

function formatSongQualitySummary(song: SongbookSong): string {
  if (song.qualityFlags.length === 0) {
    return 'No quality issues detected.'
  }

  return song.qualityFlags
    .map((flag) => `${flag.label}: ${flag.message}`)
    .join(' • ')
}

function getSongQualityBadgeClass(score: number): string {
  if (score >= 50) {
    return 'critical'
  }
  if (score >= 20) {
    return 'warning'
  }
  return 'notice'
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

type SessionControlPageProps = {
  auth: StoredAuth
  sessions: SessionRecord[]
  onRefreshSessions: () => void
  onArchiveSession: (sessionId: string) => void
}

type ReserveSongModalProps = {
  isOpen: boolean
  song: SongbookSong | null
  existingNicknames: string[]
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (nickname: string) => void
}

function ReserveSongModal({
  isOpen,
  song,
  existingNicknames,
  isSubmitting,
  onClose,
  onSubmit,
}: ReserveSongModalProps) {
  const [selectedOption, setSelectedOption] = useState('')
  const [newNickname, setNewNickname] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setSelectedOption('')
      setNewNickname('')
    }
  }, [isOpen])

  if (!isOpen || song === null) {
    return null
  }

  const isCreateNew = selectedOption === '__create_new__'
  const selectedNickname = isCreateNew ? newNickname.trim() : selectedOption.trim()
  const canSubmit = selectedNickname !== '' && !isSubmitting

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Reserve song for user"
      >
        <div className="modal-header">
          <div>
            <h2>Reserve Song</h2>
            <p className="subtitle">{song.title}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="form top-gap">
          <label>
            Select nickname
            <select
              value={selectedOption}
              onChange={(event) => setSelectedOption(event.target.value)}
              disabled={isSubmitting}
            >
              <option value="">Select existing nickname...</option>
              {existingNicknames.map((nickname) => (
                <option key={nickname} value={nickname}>
                  {nickname}
                </option>
              ))}
              <option value="__create_new__">Create New</option>
            </select>
          </label>
          {isCreateNew ? (
            <label>
              New nickname
              <input
                value={newNickname}
                onChange={(event) => setNewNickname(event.target.value)}
                placeholder="Enter nickname"
                maxLength={50}
                autoFocus
              />
            </label>
          ) : null}
        </div>

        <div className="row-actions top-gap">
          <button type="button" disabled={!canSubmit} onClick={() => onSubmit(selectedNickname)}>
            {isSubmitting ? 'Reserving…' : 'Reserve'}
          </button>
        </div>
      </section>
    </div>
  )
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
    retryDownload,
    searchSongbook,
    reserveSessionQueueSong,
    removeQueueItem,
    stopDownload,
    updateSessionMetadata,
    updateSongAdminDetails,
  } = useAdminService()
  const params = useParams<{ sessionCode: string }>()
  const sessionCode = params.sessionCode ?? ''
  const [socketStatus, setSocketStatus] = useState('Connecting...')
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>([])
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [retryingDownloadSongIds, setRetryingDownloadSongIds] = useState<string[]>([])
  const [stoppingDownloadSongIds, setStoppingDownloadSongIds] = useState<string[]>([])
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
  const [isSeekingPlayback, setIsSeekingPlayback] = useState(false)
  const [seekDraftPositionSeconds, setSeekDraftPositionSeconds] = useState<number | null>(null)
  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null)
  const [participants, setParticipants] = useState<SessionParticipant[]>([])
  const [sessionTitleInput, setSessionTitleInput] = useState('')
  const [vibesInput, setVibesInput] = useState('')
  const [isSessionEditorOpen, setIsSessionEditorOpen] = useState(false)
  const [mobileRightPanel, setMobileRightPanel] = useState<'songbook' | 'participants' | null>(null)
  const [isReservationsHistoryOpen, setIsReservationsHistoryOpen] = useState(false)
  const [isReservationsReorderOpen, setIsReservationsReorderOpen] = useState(false)
  const [reservationReorderDraft, setReservationReorderDraft] = useState<SongQueueItem[]>([])
  const [reservationDragSongId, setReservationDragSongId] = useState<string | null>(null)
  const [reservationDropIndex, setReservationDropIndex] = useState<number | null>(null)
  const [isSavingReservationOrder, setIsSavingReservationOrder] = useState(false)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [guestJoinQrDataUrl, setGuestJoinQrDataUrl] = useState<string | null>(null)
  const [isGeneratingGuestQr, setIsGeneratingGuestQr] = useState(false)
  const [guestJoinBaseUrl, setGuestJoinBaseUrl] = useState(() => window.location.origin)
  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false)
  const [reserveSongTarget, setReserveSongTarget] = useState<SongbookSong | null>(null)
  const [isSubmittingReserve, setIsSubmittingReserve] = useState(false)
  const [previewSong, setPreviewSong] = useState<SongbookSong | null>(null)
  const [previewSongAction, setPreviewSongAction] = useState<'reserve' | 'remove-from-queue' | 'view-only'>('reserve')
  const [previewQueueItemId, setPreviewQueueItemId] = useState<string | null>(null)
  const [isRemovingQueueItem, setIsRemovingQueueItem] = useState(false)
  const [editingSong, setEditingSong] = useState<SongbookSong | null>(null)
  const [editingSongThumbnailDataUrl, setEditingSongThumbnailDataUrl] = useState<string | null>(null)
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false)
  const [suggestDraft, setSuggestDraft] = useState<SuggestDraft | null>(null)
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
    () => buildGuestJoinUrl(guestJoinBaseUrl, activeSessionCode),
    [activeSessionCode, guestJoinBaseUrl],
  )
  const seekPositionSeconds =
    isSeekingPlayback && seekDraftPositionSeconds !== null
      ? seekDraftPositionSeconds
      : playbackState.positionSeconds

  useEffect(() => {
    let cancelled = false
    void fetchGuestBaseUrl()
      .then((url) => {
        if (!cancelled) {
          setGuestJoinBaseUrl(url)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuestJoinBaseUrl(window.location.origin)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const seekDraftPositionRef = useRef(0)

  const beginSeek = useCallback(() => {
    if (isSeekingPlayback) {
      return
    }
    seekDraftPositionRef.current = playbackState.positionSeconds
    setSeekDraftPositionSeconds(playbackState.positionSeconds)
    setIsSeekingPlayback(true)
  }, [isSeekingPlayback, playbackState.positionSeconds])

  const updateSeekDraft = useCallback((nextPosition: number) => {
    seekDraftPositionRef.current = nextPosition
    setSeekDraftPositionSeconds(nextPosition)
  }, [])

  const commitSeek = useCallback(() => {
    if (!isSeekingPlayback && seekDraftPositionSeconds === null) {
      return
    }
    const nextPosition =
      seekDraftPositionSeconds !== null ? seekDraftPositionSeconds : seekDraftPositionRef.current
    setIsSeekingPlayback(false)
    setSeekDraftPositionSeconds(null)
    setPlaybackState((previous) => ({ ...previous, positionSeconds: nextPosition }))
    sendCommand('playback.seek', { position_seconds: nextPosition })
  }, [isSeekingPlayback, seekDraftPositionSeconds, sendCommand])

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

  const handleReserveSong = useCallback(async (songId: string, reservedForNickname: string) => {
    if (activeSessionCode === null || songId === '') {
      return
    }
    const normalizedNickname = reservedForNickname.trim()
    if (normalizedNickname === '') {
      return
    }
    setWsMessage('')
    setIsSubmittingReserve(true)
    try {
      await reserveSessionQueueSong(activeSessionCode, songId, auth.accessToken, normalizedNickname)
      await refreshQueue()
      await loadSongbook()
      await refreshParticipants()
      setWsMessage('Song reserved.')
      setIsReserveModalOpen(false)
      setReserveSongTarget(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reserve song'
      setWsMessage(message)
    } finally {
      setIsSubmittingReserve(false)
    }
  }, [activeSessionCode, auth.accessToken, loadSongbook, refreshParticipants, refreshQueue])

  const reserveNicknameOptions = useMemo(() => {
    const usernames = new Set<string>()
    participants.forEach((participant) => {
      const normalized = participant.username.trim()
      if (normalized !== '') {
        usernames.add(normalized)
      }
    })
    queueItems.forEach((item) => {
      const normalized = (item.reservedByUsername ?? '').trim()
      if (normalized !== '') {
        usernames.add(normalized)
      }
    })
    return Array.from(usernames).sort((a, b) => a.localeCompare(b))
  }, [participants, queueItems])

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
    setPreviewSong(null)
    try {
      const detail = await fetchSongDetail(songId, undefined, activeSessionId)
      setEditingSong(detail)
      setEditingSongThumbnailDataUrl(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load song details'
      setWsMessage(message)
    }
  }, [activeSessionCode, activeSessionId])

  const openSongDetails = useCallback(async (
    songId: string,
    action: 'reserve' | 'remove-from-queue' | 'view-only' = 'reserve',
    queueItemId: string | null = null,
  ) => {
    if (activeSessionCode === null || activeSessionId === null) {
      return
    }
    setPreviewSong(null)
    setPreviewSongAction(action)
    setPreviewQueueItemId(queueItemId)
    try {
      const detail = await fetchSongDetail(songId, undefined, activeSessionId)
      setPreviewSong(detail)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load song details'
      setWsMessage(message)
    }
  }, [activeSessionCode, activeSessionId])

  const handleOpenSongDetails = useCallback((songId: string) => {
    void openSongDetails(songId, 'reserve')
  }, [openSongDetails])

  const handleOpenQueueSongDetails = useCallback((queueItem: SongQueueItem) => {
    const action = queueItem.status === 'playing' ? 'view-only' : 'remove-from-queue'
    void openSongDetails(queueItem.songId, action, action === 'remove-from-queue' ? queueItem.id : null)
  }, [openSongDetails])

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
        is_off_vocal: editingSong.isOffVocal,
        video_has_lyrics: editingSong.videoHasLyrics,
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
    void retryDownload(songId, auth.accessToken)
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
  }, [retryDownload, auth.accessToken])

  const handleStopDownload = useCallback((songId: string) => {
    setStoppingDownloadSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
    void stopDownload(songId, auth.accessToken)
      .finally(() => {
        setStoppingDownloadSongIds((current) => current.filter((entry) => entry !== songId))
      })
  }, [stopDownload, auth.accessToken])

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

  const closeSongDetails = useCallback(() => {
    setPreviewSong(null)
    setPreviewSongAction('reserve')
    setPreviewQueueItemId(null)
  }, [])

  const handlePrimaryActionFromSongDetails = useCallback(() => {
    if (previewSong === null) {
      return
    }
    if (previewSongAction === 'view-only') {
      return
    }
    if (previewSongAction === 'remove-from-queue') {
      if (activeSessionCode === null || previewQueueItemId === null) {
        return
      }
      setWsMessage('')
      setIsRemovingQueueItem(true)
      void removeQueueItem(activeSessionCode, previewQueueItemId, auth.accessToken)
        .then(async () => {
          await refreshQueue()
          await loadSongbook()
          await refreshParticipants()
          setWsMessage('Removed from queue.')
          closeSongDetails()
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to remove queue item'
          setWsMessage(message)
        })
        .finally(() => {
          setIsRemovingQueueItem(false)
        })
      return
    }
    setReserveSongTarget(previewSong)
    setIsReserveModalOpen(true)
    setPreviewSong(null)
    setPreviewSongAction('reserve')
    setPreviewQueueItemId(null)
  }, [activeSessionCode, auth.accessToken, closeSongDetails, loadSongbook, previewQueueItemId, previewSong, previewSongAction, refreshParticipants, refreshQueue, removeQueueItem])

  const handleEditFromSongDetails = useCallback(() => {
    if (previewSong === null) {
      return
    }
    const songId = previewSong.id
    setPreviewSong(null)
    void handleOpenSongEditor(songId)
  }, [handleOpenSongEditor, previewSong])

  const knownTagSuggestions = useMemo(() => {
    const entries = songbookItems.flatMap((song) => song.tags.map((tag) => tag.trim().toLowerCase()))
    return Array.from(new Set(entries.filter((entry) => entry !== '')))
  }, [songbookItems])

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
    setReservationDropIndex(null)
    setIsReservationsReorderOpen(true)
  }, [pendingQueueItems])

  const closeReservationsReorderModal = useCallback(() => {
    if (isSavingReservationOrder) {
      return
    }
    setIsReservationsReorderOpen(false)
    setReservationDragSongId(null)
    setReservationDropIndex(null)
  }, [isSavingReservationOrder])

  const saveReservationsReorder = useCallback(async () => {
    if (activeSessionCode === null) {
      return
    }

    setIsSavingReservationOrder(true)
    try {
      const latestQueueItems = await fetchSessionQueue(activeSessionCode, auth.accessToken)
      const latestPendingItems = latestQueueItems
        .filter((item) => item.status === 'pending')
        .sort((left, right) => left.queueOrder - right.queueOrder)
      const latestPendingIds = new Set(latestPendingItems.map((item) => item.id))
      const draftItems = reservationReorderDraft.filter((item) => latestPendingIds.has(item.id))
      const draftIds = new Set(draftItems.map((item) => item.id))
      const untouchedItems = latestPendingItems.filter((item) => !draftIds.has(item.id))
      const reorderedItems = [...draftItems, ...untouchedItems]

      if (reorderedItems.length === 0) {
        setIsReservationsReorderOpen(false)
        setReservationDragSongId(null)
        setReservationDropIndex(null)
        setWsMessage('No pending songs left to reorder.')
        return
      }

      for (let index = reorderedItems.length - 1; index >= 0; index -= 1) {
        const item = reorderedItems[index]
        await apiJson<{ message: string }>(
          `/sessions/${activeSessionCode}/queue/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              action: 'reorder',
              target_order: index + 1,
            }),
          },
          auth.accessToken,
        )
      }
      setIsReservationsReorderOpen(false)
      setReservationDragSongId(null)
      setReservationDropIndex(null)
      await refreshQueue()
      setWsMessage('Reservation order updated.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reservation order'
      setWsMessage(message)
    } finally {
      setIsSavingReservationOrder(false)
    }
  }, [activeSessionCode, auth.accessToken, fetchSessionQueue, refreshQueue, reservationReorderDraft])

  const handleReservationDragStart = useCallback((songId: string) => {
    setReservationDragSongId(songId)
  }, [])

  const handleReservationDragEnd = useCallback(() => {
    setReservationDragSongId(null)
    setReservationDropIndex(null)
  }, [])

  const moveReservationDraftItem = useCallback((queueItemId: string, delta: number) => {
    setReservationReorderDraft((current) => {
      const sourceIndex = current.findIndex((item) => item.id === queueItemId)
      if (sourceIndex < 0) {
        return current
      }

      const targetIndex = sourceIndex + delta
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current
      }

      return moveArrayItem(current, sourceIndex, targetIndex)
    })
    setReservationDragSongId(null)
    setReservationDropIndex(null)
  }, [])

  const handleReservationDragOver = useCallback((dropIndex: number) => {
    setReservationDropIndex(dropIndex)
  }, [])

  const handleReservationDrop = useCallback((targetIndex: number) => {
    setReservationReorderDraft((current) => {
      const sourceIndex = current.findIndex((item) => item.songId === reservationDragSongId)
      if (sourceIndex < 0) {
        return current
      }
      const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
      const finalIndex = Math.max(0, Math.min(insertionIndex, current.length - 1))
      if (finalIndex === sourceIndex) {
        return current
      }
      return moveArrayItem(current, sourceIndex, finalIndex)
    })
    setReservationDragSongId(null)
    setReservationDropIndex(null)
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
          setWsMessage('Session ended. Returning to dashboard.')
          refreshSessionsRef.current()
          window.setTimeout(() => navigate('/admin/dashboard'), 500)
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
          <button type="button" className="secondary" onClick={() => navigate('/admin/dashboard')}>
            Back to dashboard
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
                  onClick={() => navigate('/admin/dashboard')}
                  title="Back to dashboard"
                  aria-label="Back to dashboard"
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
                <span className="playback-duration-label">{formatDurationClock(seekPositionSeconds)}</span>
                <input
                  className="playback-seek"
                  type="range"
                  min={0}
                  max={playbackState.durationSeconds > 0 ? playbackState.durationSeconds : 100}
                  step={0.1}
                  value={Math.min(
                    playbackState.durationSeconds > 0 ? playbackState.durationSeconds : 100,
                    Math.max(0, seekPositionSeconds),
                  )}
                  style={
                    {
                      '--range-progress': `${
                        playbackState.durationSeconds > 0
                          ? Math.min(100, Math.max(0, (seekPositionSeconds / playbackState.durationSeconds) * 100))
                          : Math.min(100, Math.max(0, seekPositionSeconds))
                      }%`,
                    } as CSSProperties
                  }
                  onChange={(event) => {
                    const nextPosition = Number(event.target.value)
                    if (isSeekingPlayback) {
                      updateSeekDraft(nextPosition)
                      return
                    }
                    seekDraftPositionRef.current = nextPosition
                    setSeekDraftPositionSeconds(nextPosition)
                    setPlaybackState((previous) => ({ ...previous, positionSeconds: nextPosition }))
                    sendCommand('playback.seek', { position_seconds: nextPosition })
                  }}
                  onPointerDown={beginSeek}
                  onPointerUp={commitSeek}
                  onPointerCancel={commitSeek}
                  onBlur={commitSeek}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitSeek()
                    }
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
                        onClick={() => void handleOpenQueueSongDetails(song)}
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
                  onClick={() => setIsSuggestModalOpen(true)}
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
                  {songbookItems.map((song) => {
                    const qualityBadge =
                      song.qualityScore > 0 ? (
                        <span
                          className={`songbook-quality-indicator ${getSongQualityBadgeClass(song.qualityScore)}`}
                          title={formatSongQualitySummary(song)}
                          aria-label={`Quality score ${song.qualityScore}`}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">
                            priority_high
                          </span>
                        </span>
                      ) : null
                    const playedBadge =
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
                      ) : null

                    return (
                      <SongbookListItem
                        key={song.id}
                        song={song}
                        onClick={() => void handleOpenSongDetails(song.id)}
                        badge={
                          qualityBadge !== null || playedBadge !== null ? (
                            <span className="songbook-item-badges">
                              {qualityBadge}
                              {playedBadge}
                            </span>
                          ) : undefined
                        }
                      />
                    )
                  })}
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
          stoppingSongIds={stoppingDownloadSongIds}
          onClose={() => setIsDownloadsModalOpen(false)}
          onRetryDownload={handleRetryDownload}
          onStopDownload={handleStopDownload}
        />
        <ReserveSongModal
          isOpen={isReserveModalOpen}
          song={reserveSongTarget}
          existingNicknames={reserveNicknameOptions}
          isSubmitting={isSubmittingReserve}
          onClose={() => {
            if (isSubmittingReserve) {
              return
            }
            setIsReserveModalOpen(false)
            setReserveSongTarget(null)
          }}
          onSubmit={(nickname) => {
            if (reserveSongTarget === null) {
              return
            }
            void handleReserveSong(reserveSongTarget.id, nickname)
          }}
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
            aria-label="Re-arrange Songs"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Re-arrange Songs</h2>
              <button
                type="button"
                className="icon-control-button"
                onClick={closeReservationsReorderModal}
                disabled={isSavingReservationOrder}
                aria-label="Close rearrange songs dialog"
                title="Close"
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="queue-body top-gap">
              <div className="queue-scrollframe">
                <div className="queue-list reservation-reorder-list">
                  {reservationReorderDraft.length === 0 ? (
                    <p className="empty-state">Nothing to re-arrange after the current song.</p>
                  ) : (
                    <>
                      <div
                        className={`reservation-drop-zone ${reservationDropIndex === 0 ? 'is-active' : ''}`}
                        onDragOver={(event) => {
                          event.preventDefault()
                          handleReservationDragOver(0)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          handleReservationDrop(0)
                        }}
                        role="presentation"
                        aria-hidden="true"
                      >
                        <span className="reservation-drop-line" />
                      </div>
                      {reservationReorderDraft.map((item, index) => (
                        <Fragment key={item.id}>
                          <ReservationListItem
                            item={item}
                            draggable
                            dragHandleLabel="Drag to reorder song"
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', item.songId)
                              handleReservationDragStart(item.songId)
                            }}
                            onDragEnd={handleReservationDragEnd}
                            className={reservationDragSongId === item.songId ? 'is-dragging' : ''}
                            rightActions={
                              <div className="reservation-item-step-controls" role="group" aria-label="Move reservation">
                                <button
                                  type="button"
                                  className="icon-control-button reservation-step-button"
                                  onClick={() => moveReservationDraftItem(item.id, -index)}
                                  disabled={index === 0 || isSavingReservationOrder}
                                  aria-label={`Move ${item.title} to top`}
                                  title="Move to top"
                                >
                                  <span className="material-symbols-outlined" aria-hidden="true">
                                    vertical_align_top
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="icon-control-button reservation-step-button"
                                  onClick={() => moveReservationDraftItem(item.id, -1)}
                                  disabled={index === 0 || isSavingReservationOrder}
                                  aria-label={`Move ${item.title} up`}
                                  title="Move up"
                                >
                                  <span className="material-symbols-outlined" aria-hidden="true">
                                    keyboard_arrow_up
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="icon-control-button reservation-step-button"
                                  onClick={() => moveReservationDraftItem(item.id, 1)}
                                  disabled={index === reservationReorderDraft.length - 1 || isSavingReservationOrder}
                                  aria-label={`Move ${item.title} down`}
                                  title="Move down"
                                >
                                  <span className="material-symbols-outlined" aria-hidden="true">
                                    keyboard_arrow_down
                                  </span>
                                </button>
                              </div>
                            }
                          />
                          <div
                            className={`reservation-drop-zone ${reservationDropIndex === index + 1 ? 'is-active' : ''}`}
                            onDragOver={(event) => {
                              event.preventDefault()
                              handleReservationDragOver(index + 1)
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              handleReservationDrop(index + 1)
                            }}
                            role="presentation"
                            aria-hidden="true"
                          >
                            <span className="reservation-drop-line" />
                          </div>
                        </Fragment>
                      ))}
                    </>
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
              <button
                type="button"
                className="danger-button"
                onClick={() => onArchiveSession(session.id)}
                disabled={isSavingSessionMeta}
              >
                End Session
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {previewSong !== null ? (
        <SongDetailsModal
          isOpen
          song={previewSong}
          onClose={closeSongDetails}
          reserveLabel={previewSongAction === 'remove-from-queue' ? 'Remove from Queue' : 'Reserve'}
          onReserve={previewSongAction === 'view-only' ? undefined : handlePrimaryActionFromSongDetails}
          reserveDisabled={isRemovingQueueItem || isSubmittingReserve}
          isReserving={previewSongAction === 'remove-from-queue' ? isRemovingQueueItem : isSubmittingReserve}
          onEditDetails={handleEditFromSongDetails}
        />
      ) : null}

      {editingSong !== null ? (
        <SongEditModal
          song={editingSong}
          thumbnailDataUrl={editingSongThumbnailDataUrl}
          isSaving={isSavingSongMeta}
          onClose={closeSongEditor}
          onSongChange={setEditingSong}
          onThumbnailDataUrlChange={setEditingSongThumbnailDataUrl}
          onSave={() => void handleSaveSongEditor()}
          tagSuggestions={knownTagSuggestions}
          showTrimAction={false}
          showArchiveAction={false}
          showMagicFixAction={false}
        />
      ) : null}

      {isSuggestModalOpen && suggestDraft === null ? (
        <div
          className="modal-backdrop admin-session-suggest-backdrop"
          role="presentation"
          onClick={() => setIsSuggestModalOpen(false)}
        >
          <div role="presentation" onClick={(event) => event.stopPropagation()}>
            <AdminSessionSuggestSearchRoute
              auth={auth}
              onIdentifyDraft={setSuggestDraft}
              onCancel={() => setIsSuggestModalOpen(false)}
              isModal
            />
          </div>
        </div>
      ) : null}

      {isSuggestModalOpen && suggestDraft !== null ? (
        <div
          className="modal-backdrop admin-session-suggest-backdrop"
          role="presentation"
          onClick={() => {
            setIsSuggestModalOpen(false)
            setSuggestDraft(null)
          }}
        >
          <div role="presentation" onClick={(event) => event.stopPropagation()}>
            <AdminSessionSuggestUpdateRoute
              auth={auth}
              draft={suggestDraft}
              onDraftChange={(draft) => {
                setSuggestDraft(draft)
                if (draft === null) {
                  setIsSuggestModalOpen(false)
                }
              }}
              onCancel={() => {
                setIsSuggestModalOpen(false)
                setSuggestDraft(null)
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  )
}
