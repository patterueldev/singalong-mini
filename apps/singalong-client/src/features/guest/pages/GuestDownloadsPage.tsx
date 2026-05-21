import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { apiJson } from '../../../shared/api/httpClient'
import { buildWSUrl } from '../../../shared/api/ws'
import { formatDownloadStatus } from '../../../shared/lib/format'
import { normalizeDownloadProgressItems } from '../../shared/services/queueTransforms'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestRetrySongDownload } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import type { DownloadProgressItem, SongDownloadListResponse, WSIncoming } from '../../../shared/types/client'

export function GuestDownloadsPage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  const [items, setItems] = useState<DownloadProgressItem[]>([])
  const [status, setStatus] = useState('Disconnected')
  const [retryingSongIds, setRetryingSongIds] = useState<string[]>([])
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
      setItems([])
      setStatus('Disconnected')
      return
    }

    let cancelled = false
    setStatus('Connecting...')

    void apiJson<SongDownloadListResponse>('/songs/downloads', {}, guestAuth.accessToken)
      .then((payload) => {
        if (!cancelled) {
          setItems(normalizeDownloadProgressItems(payload.items))
          setStatus('Connected')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('Connection error')
        }
      })

    const socket = new WebSocket(
      buildWSUrl('/ws/guest', { session_code: sessionCode, token: guestAuth.accessToken }),
    )
    socketRef.current = socket

    socket.onopen = () => {
      if (!cancelled) {
        setStatus('Connected')
      }
    }

    socket.onclose = () => {
      if (!cancelled) {
        setStatus('Disconnected')
      }
    }

    socket.onerror = () => {
      if (!cancelled) {
        setStatus('Connection error')
      }
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
      setItems(normalizeDownloadProgressItems(payload.payload.items))
    }

    return () => {
      cancelled = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [guestAuth, hasGuestSession, sessionCode])

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/guest/join" replace />
  }

  const handleRetry = async (songId: string) => {
    setRetryingSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
    try {
      await guestRetrySongDownload(songId)
    } finally {
      setRetryingSongIds((current) => current.filter((entry) => entry !== songId))
    }
  }

  return (
    <main className="app-shell guest-shell">
      <section className="card guest-home-card">
        <div className="card-header">
          <div>
            <h1>Downloads</h1>
            <p className="subtitle">Status: {status}</p>
          </div>
          <button type="button" className="secondary" onClick={() => navigate('/guest/home')}>
            Back
          </button>
        </div>

        <div className="top-gap">
          {items.length === 0 ? (
            <p className="empty-state">No active downloads.</p>
          ) : (
            <div className="downloads-modal-list">
              {items.map((item) => {
                const isRetrying = retryingSongIds.includes(item.songId)
                const progressValue = item.progressPct !== null ? Math.max(0, Math.min(100, item.progressPct)) : 0
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
                          <progress className="downloads-progress-bar" max={100} value={progressValue} />
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
                            onClick={() => void handleRetry(item.songId)}
                            disabled={isRetrying}
                          >
                            {isRetrying ? 'Retrying…' : 'Retry'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
