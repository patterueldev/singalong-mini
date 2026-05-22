import { useCallback, useRef, useState } from 'react'
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
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null)

  // Load trim history on demand (button click), not on mount
  const loadTrimHistory = useCallback(async () => {
    setIsLoadingHistory(true)
    try {
      const history = await getTrimHistory(song.id, auth.accessToken)
      setTrimHistory(history)
    } catch (error) {
      console.error('Failed to load trim history:', error)
      setErrorMessage('Failed to load trim history')
      setTrimHistory([])
    } finally {
      setIsLoadingHistory(false)
    }
  }, [song.id, auth.accessToken, getTrimHistory])

  // Initialize end time when video loads
  const handleVideoDurationChange = useCallback(() => {
    if (videoRef.current) {
      const durationMs = videoRef.current.duration * 1000
      setVideoDurationMs(durationMs)
      setEndTimeMs(durationMs)
    }
  }, [])

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
      await loadTrimHistory()
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

  if (!isOpen || !song) return null

  const startPercentage = videoDurationMs > 0 ? (startTimeMs / videoDurationMs) * 100 : 0
  const endPercentage = videoDurationMs > 0 ? (endTimeMs / videoDurationMs) * 100 : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="song-trim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trim Video: {song.title}</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Video Player */}
          <div className="trim-video-container top-gap">
            <video
              ref={videoRef}
              src={`/media/songs/${song.videoFile}`}
              controls
              className="trim-video-player"
              onLoadedMetadata={handleVideoDurationChange}
            />
          </div>

          {/* Timeline */}
          <div className="trim-timeline-section top-gap">
            <div className="trim-timeline" onClick={handleTimelineClick}>
              <div
                className="trim-range"
                style={{
                  left: `${startPercentage}%`,
                  right: `${100 - endPercentage}%`,
                }}
              />
              <div className="trim-marker trim-marker-start" style={{ left: `${startPercentage}%` }} />
              <div className="trim-marker trim-marker-end" style={{ left: `${endPercentage}%` }} />
            </div>
          </div>

          {/* Time Inputs */}
          <div className="trim-time-inputs top-gap">
            <div className="time-input-group">
              <label>Start Time</label>
              <input
                type="text"
                value={formatTimeMs(startTimeMs)}
                onChange={(e) => {
                  const ms = parseTimeMs(e.target.value)
                  setStartTimeMs(Math.max(0, Math.min(ms, endTimeMs - 1000)))
                }}
                disabled={isTrimming}
              />
            </div>
            <div className="time-input-group">
              <label>End Time</label>
              <input
                type="text"
                value={formatTimeMs(endTimeMs)}
                onChange={(e) => {
                  const ms = parseTimeMs(e.target.value)
                  setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(ms, videoDurationMs)))
                }}
                disabled={isTrimming}
              />
            </div>
            <div className="time-input-group">
              <label>Duration</label>
              <input
                type="text"
                value={formatTimeMs(endTimeMs - startTimeMs)}
                disabled
              />
            </div>
          </div>

          {/* Messages */}
          {errorMessage && <div className="error-message top-gap">{errorMessage}</div>}
          {successMessage && <div className="success-message top-gap">{successMessage}</div>}

          {/* Trim Button */}
          <div className="modal-actions top-gap">
            <button
              className="btn-primary"
              onClick={handleTrimVideo}
              disabled={isTrimming || videoDurationMs === 0}
            >
              {isTrimming ? 'Trimming...' : 'Trim Video'}
            </button>
            <button className="btn-secondary" onClick={onClose} disabled={isTrimming}>
              Cancel
            </button>
          </div>

          {/* Load History Button */}
          <div className="top-gap">
            <button
              className="btn-link"
              onClick={loadTrimHistory}
              disabled={isLoadingHistory || isTrimming}
            >
              {isLoadingHistory ? 'Loading...' : trimHistory.length > 0 ? 'Reload History' : 'Load History'}
            </button>
          </div>

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
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                      {item.backup_expires_at && (
                        <p className="trim-history-expires">
                          Backup expires: {new Date(item.backup_expires_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <button
                      className="btn-restore"
                      onClick={() => handleRestoreTrim(item.id)}
                      disabled={restoringHistoryId === item.id || isTrimming}
                    >
                      {restoringHistoryId === item.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
