import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { apiJson } from '../../../shared/api/httpClient'
import { fetchGuestBaseUrl } from '../../../shared/api/publicConfig'
import { buildWSUrl } from '../../../shared/api/ws'
import { buildGuestJoinUrl } from '../services/guestService'
import {
  normalizeDownloadProgressItems,
  normalizeSessionQueueItems,
} from '../../shared/services/queueTransforms'
import { adminService } from '../../admin/services/adminService'
import { DownloadProgressModal } from '../../songbook/components/DownloadProgressModal'
import { ReservationListItem } from '../../shared/components/ReservationListItem'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestCancelQueueItem, guestFetchSessionInfo, guestSkipQueueItem } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import { formatLanguageLabel } from '../../../shared/lib/format'
import type {
  DownloadProgressItem,
  SongDownloadListResponse,
  SongQueueItem,
  SongbookSong,
  WSIncoming,
} from '../../../shared/types/client'

type QueueAction = 'cancel' | 'skip'

type GuestQueueSongDetailModalProps = {
  queueItem: SongQueueItem
  sessionCode: string
  authToken: string
  currentGuestUserId: string
  onClose: () => void
  onQueueActionDone: () => void
}

function GuestQueueSongDetailModal({
  queueItem,
  sessionCode,
  authToken,
  currentGuestUserId,
  onClose,
  onQueueActionDone,
}: GuestQueueSongDetailModalProps) {
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isMutating, setIsMutating] = useState(false)
  const isOwnSong = queueItem.reservedBy === currentGuestUserId

  const action: QueueAction | null = useMemo(() => {
    if (!isOwnSong) {
      return null
    }
    if (queueItem.status === 'pending') {
      return 'cancel'
    }
    if (queueItem.status === 'playing') {
      return 'skip'
    }
    return null
  }, [isOwnSong, queueItem.status])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setErrorMessage('')
    void adminService
      .fetchSongDetail(queueItem.songId, sessionCode)
      .then((payload) => {
        if (!cancelled) {
          setSong(payload)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Song does not exist')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [queueItem.songId, sessionCode])

  const handleAction = async () => {
    if (action === null) {
      return
    }
    setErrorMessage('')
    setIsMutating(true)
    try {
      if (action === 'cancel') {
        await guestCancelQueueItem(sessionCode, queueItem.id, authToken)
      } else {
        await guestSkipQueueItem(sessionCode, queueItem.id, authToken)
      }
      onQueueActionDone()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update queue item')
    } finally {
      setIsMutating(false)
    }
  }

  const actionLabel = action === 'cancel' ? 'Cancel' : action === 'skip' ? 'Skip' : null

  return (
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal guest-song-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song?.title ?? 'Queue song details'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row-actions guest-song-detail-top-actions">
          {actionLabel !== null ? (
            <button
              type="button"
              className="danger-button"
              disabled={isMutating || isLoading}
              onClick={() => void handleAction()}
            >
              {isMutating ? `${actionLabel}...` : actionLabel}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="icon-control-button" aria-label="Close song details" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="guest-song-detail-scroll">
          {isLoading ? (
            <p className="empty-state top-gap">Loading song details…</p>
          ) : errorMessage !== '' ? (
            <p className="error-message top-gap">{errorMessage}</p>
          ) : song !== null ? (
            <div className="song-detail-layout">
              <div className="song-detail-video-panel">
                {song.videoFile ? (
                  <video controls className="song-detail-video" src={`/media/songs/${song.videoFile}`} />
                ) : (
                  <p className="empty-state">Video not available.</p>
                )}
              </div>

              <div className="song-detail-summary-panel">
                <div className="song-detail-header-row">
                  {song.thumbnailUrl ? (
                    <img className="song-detail-thumbnail song-detail-thumbnail--small" src={song.thumbnailUrl} alt={song.title} />
                  ) : (
                    <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                  )}
                  <div className="song-detail-meta">
                    <h2 className="song-detail-title">{song.title}</h2>
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
                  <div className="song-detail-grid-wide">
                    <dt>Duration</dt>
                    <dd>{song.duration}</dd>
                  </div>
                </dl>

                <div className="song-detail-chips top-gap">
                  {song.language ? <span className="chip-badge">{formatLanguageLabel(song.language)}</span> : null}
                  {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                  {song.duration ? <span className="chip-badge">{song.duration}</span> : null}
                  {song.tags.map((tag) => (
                    <span key={tag} className="chip-badge chip-badge--tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="song-detail-lyrics-panel">
                <h3>Lyrics</h3>
                <p className="song-detail-lyrics">
                  {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function GuestHomePage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, leaveGuestSession, hasGuestSession } = useGuestSession()
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>([])
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [socketStatus, setSocketStatus] = useState('Disconnected')
  const [isLoading, setIsLoading] = useState(true)
  const [sessionTitle, setSessionTitle] = useState('Session')
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [guestJoinQrDataUrl, setGuestJoinQrDataUrl] = useState<string | null>(null)
  const [isGeneratingGuestQr, setIsGeneratingGuestQr] = useState(false)
  const [guestJoinBaseUrl, setGuestJoinBaseUrl] = useState(() => window.location.origin)
  const [activeQueueItem, setActiveQueueItem] = useState<SongQueueItem | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  const closeSocket = useCallback(() => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket !== null) {
      socket.close()
    }
  }, [])

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

  const guestJoinUrl = useMemo(
    () => buildGuestJoinUrl(guestJoinBaseUrl, sessionCode),
    [guestJoinBaseUrl, sessionCode],
  )

  useEffect(() => {
    if (guestJoinUrl === '') {
      setGuestJoinQrDataUrl(null)
      setIsGeneratingGuestQr(false)
      return
    }

    let isCancelled = false
    setIsGeneratingGuestQr(true)
    void QRCode.toDataURL(guestJoinUrl, {
      width: 220,
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

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
      setQueueItems([])
      setDownloadItems([])
      setSocketStatus('Disconnected')
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setSocketStatus('Connecting...')

    void guestFetchSessionInfo(sessionCode).then((info) => {
      if (!cancelled && info.exists && info.name !== null && info.name.trim() !== '') {
        setSessionTitle(info.name)
      }
    })

    void adminService
      .fetchSessionQueue(sessionCode, guestAuth.accessToken)
      .then((items) => {
        if (!cancelled) {
          setQueueItems(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQueueItems([])
        }
      })

    void apiJson<SongDownloadListResponse>('/songs/downloads', {}, guestAuth.accessToken)
      .then((payload) => {
        if (!cancelled) {
          setDownloadItems(normalizeDownloadProgressItems(payload.items))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDownloadItems([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    const connect = () => {
      if (cancelled) {
        return
      }
      const socket = new WebSocket(
        buildWSUrl('/ws/guest', { session_code: sessionCode, token: guestAuth.accessToken }),
      )
      socketRef.current = socket

      socket.onopen = () => {
        if (!cancelled) {
          setSocketStatus('Connected')
        }
      }

      socket.onclose = () => {
        if (!cancelled) {
          setSocketStatus('Disconnected')
        }
      }

      socket.onerror = () => {
        if (!cancelled) {
          setSocketStatus('Connection error')
        }
      }

      socket.onmessage = (event) => {
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }
        if (payload.type !== 'queue.updated') {
          if (payload.type === 'downloads.updated') {
            setDownloadItems(normalizeDownloadProgressItems(payload.payload.items))
          }
          return
        }
        setQueueItems(normalizeSessionQueueItems(payload.payload.items))
      }
    }

    connect()
    return () => {
      cancelled = true
      closeSocket()
    }
  }, [closeSocket, guestAuth, hasGuestSession, sessionCode])

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/join" replace />
  }

  const activeQueueItems = useMemo(
    () =>
      queueItems
        .filter((item) => item.status === 'playing' || item.status === 'pending')
        .sort((a, b) => a.queueOrder - b.queueOrder),
    [queueItems],
  )

  const handleCopyGuestJoinUrl = useCallback(() => {
    if (guestJoinUrl === '') {
      return
    }
    void navigator.clipboard.writeText(guestJoinUrl)
  }, [guestJoinUrl])

  return (
    <main className="app-shell guest-fullscreen-shell">
      <section className="card guest-fullscreen-card guest-home-screen">
        <div className="card-header">
          <div>
            <h1>{sessionTitle} ({sessionCode})</h1>
            <p className="subtitle">
              Welcome, <strong>{guestAuth.nickname}</strong>
            </p>
          </div>
          <div className="row-actions guest-home-action-icons">
            <button
              type="button"
              className="icon-control-button"
              aria-label="Leave session"
              onClick={() => setIsLeaveModalOpen(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">exit_to_app</span>
            </button>
            <button
              type="button"
              className="icon-control-button"
              aria-label="Guest join QR"
              onClick={() => setIsQrModalOpen(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">qr_code_scanner</span>
            </button>
            <button
              type="button"
              className="icon-control-button"
              aria-label="Downloads"
              onClick={() => setIsDownloadsModalOpen(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">download</span>
            </button>
            <button
              type="button"
              className="icon-control-button"
              aria-label="Songbook"
              onClick={() => navigate('/songs')}
            >
              <span className="material-symbols-outlined" aria-hidden="true">menu_book</span>
            </button>
          </div>
        </div>

        <p className="player-socket-status top-gap" aria-label="Guest queue status">
          <span className="material-symbols-outlined" aria-hidden="true">
            queue_music
          </span>{' '}
          {socketStatus}
        </p>

        <div className="top-gap guest-scroll-content">
          {isLoading ? (
            <p className="empty-state">Loading reservations…</p>
          ) : activeQueueItems.length === 0 ? (
            <p className="empty-state">No reservations yet.</p>
          ) : (
            <div className="queue-list reservations-list">
              {activeQueueItems.map((item, index) => {
                const isOwnSong = item.reservedBy === guestAuth.user.id
                return (
                  <ReservationListItem
                    key={item.id}
                    item={item}
                    showPlayingIcon={index === 0}
                    onClick={() => setActiveQueueItem(item)}
                    extraAction={isOwnSong ? <span className="chip-badge">Yours</span> : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>
      </section>

      <DownloadProgressModal
        isOpen={isDownloadsModalOpen}
        status={socketStatus}
        items={downloadItems}
        onClose={() => setIsDownloadsModalOpen(false)}
      />

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
            </div>
          </section>
        </div>
      ) : null}

      {activeQueueItem !== null ? (
        <GuestQueueSongDetailModal
          queueItem={activeQueueItem}
          sessionCode={sessionCode}
          authToken={guestAuth.accessToken}
          currentGuestUserId={guestAuth.user.id}
          onClose={() => setActiveQueueItem(null)}
          onQueueActionDone={() => setActiveQueueItem(null)}
        />
      ) : null}

      {isLeaveModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsLeaveModalOpen(false)}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Leave session confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Leave session?</h2>
            </div>
            <p className="subtitle top-gap">You will return to the join screen.</p>
            <div className="row-actions top-gap">
              <button type="button" className="secondary" onClick={() => setIsLeaveModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsLeaveModalOpen(false)
                  leaveGuestSession()
                  navigate('/join', { replace: true })
                }}
              >
                Leave Session
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
