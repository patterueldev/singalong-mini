import { useCallback, useEffect, useRef, useState } from 'react'
import type { SongbookSong, TrimHistoryItem, StoredAuth } from '../../../shared/types/client'
import { formatTimeMs, parseTimeMs } from '../../../shared/lib/format'
import { useAdminService } from '../hooks/useAdminService'

interface SongTrimModalProps {
  song: SongbookSong
  isOpen: boolean
  auth: StoredAuth
  onClose: () => void
  onTrimComplete: () => void
}

export function SongTrimModal({ song, isOpen, auth, onClose, onTrimComplete }: SongTrimModalProps) {
  const { trimSong, getTrimHistory, restoreTrim } = useAdminService()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [startTimeMs, setStartTimeMs] = useState(0)
  const [endTimeMs, setEndTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [trimHistory, setTrimHistory] = useState<TrimHistoryItem[]>([])
  const [isTrimming, setIsTrimming] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null)

  // Load trim history when modal opens
  useEffect(() => {
    if (!isOpen || !song) {
      setTrimHistory([])
      return
    }

    const loadHistory = async () => {
      try {
        const history = await getTrimHistory(song.id, auth.accessToken)
        setTrimHistory(history)
      } catch (error) {
        console.error('Failed to load trim history:', error)
        setTrimHistory([])
      }
    }

    loadHistory()
  }, [isOpen, song.id, auth.accessToken, getTrimHistory])

  // Initialize end time when video duration changes
  const handleVideoDurationChange = useCallback(() => {
    if (videoRef.current) {
      const durationMs = videoRef.current.duration * 1000
      setVideoDurationMs(durationMs)
      setEndTimeMs(durationMs)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.addEventListener('loadedmetadata', handleVideoDurationChange)
    return () => video.removeEventListener('loadedmetadata', handleVideoDurationChange)
  }, [handleVideoDurationChange])

  const validateTimeRange = (): boolean => {
    if (startTimeMs < 0) {
      setErrorMessage('Start time cannot be negative')
      return false
    }
    if (endTimeMs > videoDurationMs) {
      setErrorMessage('End time cannot exceed video duration')
      return false
    }
    if (startTimeMs >= endTimeMs) {
      setErrorMessage('Start time must be before end time')
      return false
    }
    const durationSeconds = (endTimeMs - startTimeMs) / 1000
    if (durationSeconds < 1) {
      setErrorMessage('Trimmed duration must be at least 1 second')
      return false
    }
    return true
  }

  const handleTrimVideo = async () => {
    setErrorMessage('')
    setSuccessMessage('')

    if (!validateTimeRange()) {
      return
    }

    setIsTrimming(true)
    try {
      await trimSong(song.id, auth.accessToken, startTimeMs, endTimeMs)
      const newDuration = formatTimeMs(endTimeMs - startTimeMs)
      setSuccessMessage(`Video trimmed successfully! New duration: ${newDuration}`)
      setTimeout(() => {
        onTrimComplete()
      }, 1500)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to trim video')
    } finally {
      setIsTrimming(false)
    }
  }

  const handleRestoreTrim = async (historyId: string) => {
    if (!window.confirm('Restore this trim? This will revert the video to its previous state.')) {
      return
    }

    setRestoringHistoryId(historyId)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await restoreTrim(song.id, auth.accessToken, historyId)
      setSuccessMessage('Video restored successfully!')
      // Reload history
      const history = await getTrimHistory(song.id, auth.accessToken)
      setTrimHistory(history)
      setTimeout(() => {
        onTrimComplete()
      }, 1500)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to restore trim')
    } finally {
      setRestoringHistoryId(null)
    }
  }

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const percentage = clickX / rect.width
    const clickTimeMs = percentage * videoDurationMs

    // Determine if we're closer to start or end marker
    const distToStart = Math.abs(clickTimeMs - startTimeMs)
    const distToEnd = Math.abs(clickTimeMs - endTimeMs)

    if (distToStart < distToEnd) {
      setStartTimeMs(Math.max(0, Math.min(clickTimeMs, endTimeMs - 1000)))
    } else {
      setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(clickTimeMs, videoDurationMs)))
    }
  }

  const startPercentage = videoDurationMs > 0 ? (startTimeMs / videoDurationMs) * 100 : 0
  const endPercentage = videoDurationMs > 0 ? (endTimeMs / videoDurationMs) * 100 : 0

  if (!isOpen) {
    return null
  }

  return (
    <div className="modal-backdrop song-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card song-detail-modal song-trim-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Trim Video: ${song.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Trim Video</h2>
            <p className="subtitle">{song.title}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={isTrimming || restoringHistoryId !== null}>
            Close
          </button>
        </div>

        <div className="song-trim-content top-gap">
          {/* Video Player */}
          {song.videoFile ? (
            <div className="trim-video-container">
              <video
                ref={videoRef}
                controls
                className="trim-video-player"
                src={`/media/songs/${song.videoFile}`}
              />
            </div>
          ) : (
            <p className="empty-state">Video not available.</p>
          )}

          {/* Messages */}
          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
          {successMessage && <p className="success-message">{successMessage}</p>}

          {/* Trim Controls */}
          {song.videoFile && (
            <div className="trim-controls top-gap">
              <div className="trim-time-inputs">
                <label className="form-field form-field--inline">
                  <span className="form-label">Start (MM:SS)</span>
                  <input
                    type="text"
                    className="form-input form-input--small"
                    value={formatTimeMs(startTimeMs)}
                    onChange={(e) => {
                      const ms = parseTimeMs(e.target.value)
                      setStartTimeMs(Math.max(0, Math.min(ms, endTimeMs - 1000)))
                    }}
                    disabled={isTrimming}
                  />
                </label>

                <label className="form-field form-field--inline">
                  <span className="form-label">End (MM:SS)</span>
                  <input
                    type="text"
                    className="form-input form-input--small"
                    value={formatTimeMs(endTimeMs)}
                    onChange={(e) => {
                      const ms = parseTimeMs(e.target.value)
                      setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(ms, videoDurationMs)))
                    }}
                    disabled={isTrimming}
                  />
                </label>
              </div>

              <p className="trim-duration-info">
                Duration: {formatTimeMs(videoDurationMs)} → {formatTimeMs(endTimeMs - startTimeMs)}
              </p>

              {/* Timeline Visualization */}
              <div className="trim-timeline" onClick={handleTimelineClick}>
                {/* Background bar */}
                <div className="trim-timeline-bar">
                  {/* Trimmed region highlight */}
                  <div
                    className="trim-timeline-trimmed"
                    style={{
                      left: `${startPercentage}%`,
                      right: `${100 - endPercentage}%`,
                    }}
                  />

                  {/* Start marker */}
                  <div
                    className="trim-marker trim-marker--start"
                    style={{ left: `${startPercentage}%` }}
                    role="slider"
                    aria-label="Start trim point"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const startX = e.clientX
                      const startValue = startTimeMs

                      const handleMouseMove = (moveEvent: MouseEvent) => {
                        const rect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
                        if (!rect) return
                        const deltaX = moveEvent.clientX - startX
                        const percentage = deltaX / rect.width
                        const newTimeMs = startValue + percentage * videoDurationMs
                        setStartTimeMs(Math.max(0, Math.min(newTimeMs, endTimeMs - 1000)))
                      }

                      const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove)
                        document.removeEventListener('mouseup', handleMouseUp)
                      }

                      document.addEventListener('mousemove', handleMouseMove)
                      document.addEventListener('mouseup', handleMouseUp)
                    }}
                  />

                  {/* End marker */}
                  <div
                    className="trim-marker trim-marker--end"
                    style={{ left: `${endPercentage}%` }}
                    role="slider"
                    aria-label="End trim point"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const startX = e.clientX
                      const startValue = endTimeMs

                      const handleMouseMove = (moveEvent: MouseEvent) => {
                        const rect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
                        if (!rect) return
                        const deltaX = moveEvent.clientX - startX
                        const percentage = deltaX / rect.width
                        const newTimeMs = startValue + percentage * videoDurationMs
                        setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(newTimeMs, videoDurationMs)))
                      }

                      const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove)
                        document.removeEventListener('mouseup', handleMouseUp)
                      }

                      document.addEventListener('mousemove', handleMouseMove)
                      document.addEventListener('mouseup', handleMouseUp)
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Trim History */}
          {trimHistory.length > 0 && (
            <div className="trim-history top-gap">
              <h3>Trim History</h3>
              <div className="trim-history-list">
                {trimHistory.map((item) => (
                  <div key={item.id} className="trim-history-item">
                    <div className="trim-history-info">
                      <p className="trim-history-range">
                        {formatTimeMs(item.trim_start_ms)} → {formatTimeMs(item.trim_end_ms)}
                      </p>
                      <p className="trim-history-meta">
                        <span className={`trim-status trim-status--${item.status}`}>{item.status}</span>
                        {item.created_at && (
                          <span className="trim-history-date">
                            {new Date(item.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                      {item.backup_expires_at && (
                        <p className="trim-history-expiry">
                          Backup expires: {new Date(item.backup_expires_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {item.can_restore && item.status === 'completed' && (
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => void handleRestoreTrim(item.id)}
                        disabled={restoringHistoryId !== null || isTrimming}
                      >
                        {restoringHistoryId === item.id ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {song.videoFile && (
          <div className="row-actions top-gap">
            <button
              type="button"
              onClick={() => void handleTrimVideo()}
              disabled={isTrimming || !validateTimeRange() || restoringHistoryId !== null}
            >
              {isTrimming ? 'Trimming…' : '✂️ Trim Video'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={isTrimming || restoringHistoryId !== null}
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
