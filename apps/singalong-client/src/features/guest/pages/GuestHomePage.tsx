import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { buildWSUrl } from '../../../shared/api/ws'
import { normalizeSessionQueueItems } from '../../shared/services/queueTransforms'
import { adminService } from '../../admin/services/adminService'
import { ReservationListItem } from '../../shared/components/ReservationListItem'
import { useGuestSession } from '../hooks/useGuestSession'
import { isValidSessionCode } from '../../../shared/lib/validation'
import type { SongQueueItem, WSIncoming } from '../../../shared/types/client'

export function GuestHomePage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, leaveGuestSession, hasGuestSession } = useGuestSession()
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>([])
  const [socketStatus, setSocketStatus] = useState('Disconnected')
  const [isLoading, setIsLoading] = useState(true)
  const socketRef = useRef<WebSocket | null>(null)

  const closeSocket = useCallback(() => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket !== null) {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
      setQueueItems([])
      setSocketStatus('Disconnected')
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setSocketStatus('Connecting...')

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
    return <Navigate to="/guest/join" replace />
  }

  return (
    <main className="app-shell guest-shell">
      <section className="card guest-home-card">
        <div className="card-header">
          <div>
            <h1>Session {sessionCode}</h1>
            <p className="subtitle">
              Welcome, <strong>{guestAuth.nickname}</strong>
            </p>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => navigate('/guest/downloads')}>
              Downloads
            </button>
            <button type="button" onClick={() => navigate('/guest/songbook')}>
              Songbook
            </button>
          </div>
        </div>

        <div className="row-actions top-gap">
          <button type="button" className="secondary small" onClick={() => navigate('/guest/join')}>
            Change nickname
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              leaveGuestSession()
              navigate('/guest/join', { replace: true })
            }}
          >
            Leave session
          </button>
        </div>

        <p className="player-socket-status top-gap" aria-label="Guest queue status">
          <span className="material-symbols-outlined" aria-hidden="true">
            queue_music
          </span>{' '}
          {socketStatus}
        </p>

        <div className="top-gap">
          {isLoading ? (
            <p className="empty-state">Loading reservations…</p>
          ) : queueItems.length === 0 ? (
            <p className="empty-state">No reservations yet.</p>
          ) : (
            <div className="queue-list reservations-list">
              {queueItems.map((item) => (
                <ReservationListItem
                  key={item.id}
                  item={item}
                  showPlayingIcon={item.status === 'playing'}
                  showOutcome
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
