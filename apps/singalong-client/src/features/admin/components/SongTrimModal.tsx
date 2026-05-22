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
  const timelineRef = useRef<HTMLDivElement>(null)

  const [startTimeMs, setStartTimeMs] = useState(0)
  const [endTimeMs, setEndTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [trimHistory, setTrimHistory] = useState<TrimHistoryItem[]>([])
  const [isTrimming, setIsTrimming] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isDraggingStart, setIsDraggingStart] = useState(false)
  const [isDraggingEnd, setIsDraggingEnd] = useState(false)
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
      console.log('🎬 Video loaded:', {
        durationSeconds: videoRef.current.duration,
        durationMs: durationMs,
        durationFormatted: `${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`,
      })
    }
  }, [])

  // Mark current position as start
  const markStart = useCallback(() => {
    if (videoRef.current) {
      const currentMs = videoRef.current.currentTime * 1000
      setStartTimeMs(Math.max(0, Math.min(currentMs, endTimeMs - 1000)))
    }
  }, [endTimeMs])

  // Mark current position as end
  const markEnd = useCallback(() => {
    if (videoRef.current) {
      const currentMs = videoRef.current.currentTime * 1000
      setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(currentMs, videoDurationMs)))
    }
  }, [startTimeMs, videoDurationMs])

  // Seek to start time and play
  const seekToStart = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTimeMs / 1000
      videoRef.current.play()
    }
  }, [startTimeMs])

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
    console.log('📹 Trimming video:', {
      startTimeMs: Math.round(startTimeMs),
      endTimeMs: Math.round(endTimeMs),
      videoDurationMs: videoDurationMs,
      startFormatted: formatTimeMs(startTimeMs),
      endFormatted: formatTimeMs(endTimeMs),
    })
    try {
      // Round to integers to avoid fractional milliseconds
      await trimSong(song.id, auth.accessToken, Math.round(startTimeMs), Math.round(endTimeMs))
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

  // Real-time timeline click and drag
  const updateTimelinePosition = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const clickTimeMs = percentage * videoDurationMs

    if (isDraggingStart) {
      setStartTimeMs(Math.max(0, Math.min(clickTimeMs, endTimeMs - 1000)))
    } else if (isDraggingEnd) {
      setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(clickTimeMs, videoDurationMs)))
    } else {
      // Determine which marker is closer
      const distToStart = Math.abs(clickTimeMs - startTimeMs)
      const distToEnd = Math.abs(clickTimeMs - endTimeMs)

      if (distToStart < distToEnd) {
        setStartTimeMs(Math.max(0, Math.min(clickTimeMs, endTimeMs - 1000)))
      } else {
        setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(clickTimeMs, videoDurationMs)))
      }
    }
  }

  const handleTimelineMouseDown = (marker: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (marker === 'start') {
      setIsDraggingStart(true)
    } else {
      setIsDraggingEnd(true)
    }
  }

  const handleMouseUp = () => {
    setIsDraggingStart(false)
    setIsDraggingEnd(false)
  }

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingStart || isDraggingEnd) {
      updateTimelinePosition(e)
    }
  }

  if (!isOpen || !song) return null

  const startPercentage = videoDurationMs > 0 ? (startTimeMs / videoDurationMs) * 100 : 0
  const endPercentage = videoDurationMs > 0 ? (endTimeMs / videoDurationMs) * 100 : 0

  return (
    <div 
      className="modal-backdrop song-detail-backdrop" 
      role="presentation" 
      onClick={onClose}
      onMouseUp={handleMouseUp}
    >
      <div className="modal-card song-trim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="song-trim-header">
          <h2>Trim Video: {song.title}</h2>
          <div className="trim-header-actions">
            <button 
              className="trim-history-button" 
              onClick={loadTrimHistory}
              disabled={isLoadingHistory || isTrimming}
              title="View trim history"
              aria-label="View trim history"
            >
              <span className="material-symbols-outlined">history</span>
            </button>
            <button className="trim-close-button" onClick={onClose} aria-label="Close">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="song-trim-content">
          {/* Video Player */}
          <div className="trim-video-container">
            <video
              ref={videoRef}
              src={`/media/songs/${song.videoFile}?t=${Date.now()}`}
              controls
              className="trim-video-player"
              onLoadedMetadata={handleVideoDurationChange}
            />
          </div>

          {/* Timeline */}
          <div className="trim-timeline-section">
            <div 
              ref={timelineRef}
              className="trim-timeline" 
              onClick={updateTimelinePosition}
              onMouseMove={handleTimelineMouseMove}
            >
              <div
                className="trim-range"
                style={{
                  left: `${startPercentage}%`,
                  right: `${100 - endPercentage}%`,
                }}
              />
              <div 
                className={`trim-marker trim-marker-start ${isDraggingStart ? 'dragging' : ''}`}
                style={{ left: `${startPercentage}%` }}
                onMouseDown={handleTimelineMouseDown('start')}
              />
              <div 
                className={`trim-marker trim-marker-end ${isDraggingEnd ? 'dragging' : ''}`}
                style={{ left: `${endPercentage}%` }}
                onMouseDown={handleTimelineMouseDown('end')}
              />
            </div>
          </div>

          {/* Time Inputs */}
          <div className="trim-time-inputs">
            <div className="time-input-group">
              <label>Start Time</label>
              <div className="time-input-with-actions">
                <input
                  type="text"
                  value={formatTimeMs(startTimeMs)}
                  onChange={(e) => {
                    const ms = parseTimeMs(e.target.value)
                    setStartTimeMs(Math.max(0, Math.min(ms, endTimeMs - 1000)))
                  }}
                  disabled={isTrimming}
                />
                <button 
                  className="time-action-button"
                  onClick={seekToStart}
                  title="Seek to start time and play"
                  disabled={isTrimming}
                >
                  <span className="material-symbols-outlined">play_arrow</span>
                </button>
                <button 
                  className="time-action-button"
                  onClick={markStart}
                  title="Mark current position as start"
                  disabled={isTrimming}
                >
                  <span className="material-symbols-outlined">edit_note</span>
                </button>
              </div>
            </div>
            <div className="time-input-group">
              <label>End Time</label>
              <div className="time-input-with-actions">
                <input
                  type="text"
                  value={formatTimeMs(endTimeMs)}
                  onChange={(e) => {
                    const ms = parseTimeMs(e.target.value)
                    setEndTimeMs(Math.max(startTimeMs + 1000, Math.min(ms, videoDurationMs)))
                  }}
                  disabled={isTrimming}
                />
                <button 
                  className="time-action-button"
                  onClick={markEnd}
                  title="Mark current position as end"
                  disabled={isTrimming}
                >
                  <span className="material-symbols-outlined">edit_note</span>
                </button>
              </div>
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
          {errorMessage && <div className="trim-error-message">{errorMessage}</div>}
          {successMessage && <div className="trim-success-message">{successMessage}</div>}

          {/* Trim Button */}
          <div className="trim-modal-actions">
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

          {/* Trim History */}
          {trimHistory.length > 0 && (
            <div className="trim-history">
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
