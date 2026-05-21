import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import QRCode from 'qrcode'
import { usePlayerService } from '../hooks/usePlayerService'
import { PlayerBlockedPage } from './PlayerBlockedPage'
import { buildGuestJoinUrl } from '../../guest/services/guestService'
import { normalizeSessionQueueItems } from '../../shared/services/queueTransforms'
import {
  PLAYER_ENCOURAGEMENTS,
} from '../../../shared/config/client'
import { buildWSUrl } from '../../../shared/api/ws'
import { formatDurationClock } from '../../../shared/lib/format'
import type {
  SessionRecord,
  SongbookSong,
  SongQueueItem,
  WSIncoming,
} from '../../../shared/types/client'

export function PlayerPage() {
  const {
    fetchActiveSession,
    fetchSessionQueue,
    fetchSongDetail,
    isHostAllowed: isPlayerHostAllowed,
    loginPlayer,
  } = usePlayerService()
  const hostAllowed = useMemo(() => isPlayerHostAllowed(window.location.hostname), [])
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null)
  const [playerToken, setPlayerToken] = useState<string | null>(null)
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>([])
  const [currentSong, setCurrentSong] = useState<SongbookSong | null>(null)
  const [socketStatus, setSocketStatus] = useState('Idle')
  const [videoPositionSeconds, setVideoPositionSeconds] = useState(0)
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const [playerVolumePct, setPlayerVolumePct] = useState(100)
  const [isPlayerMuted, setIsPlayerMuted] = useState(false)
  const [marqueeDistancePx, setMarqueeDistancePx] = useState(0)
  const [marqueeOffsetPx, setMarqueeOffsetPx] = useState(0)
  const [transitionMessage, setTransitionMessage] = useState('')
  const [isSongTransitioning, setIsSongTransitioning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null)
  const [guestQrDataUrl, setGuestQrDataUrl] = useState<string | null>(null)
  const [isGeneratingGuestQr, setIsGeneratingGuestQr] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const shouldReconnectRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const loopVideoRef = useRef<HTMLVideoElement | null>(null)
  const playerContainerRef = useRef<HTMLElement | null>(null)
  const queueViewportRef = useRef<HTMLDivElement | null>(null)
  const queueTrackRef = useRef<HTMLDivElement | null>(null)
  const resumePositionRef = useRef<number | null>(null)
  const resumeIsPlayingRef = useRef<boolean>(true)
  const lastNonZeroVolumeRef = useRef(100)
  const previousQueueItemIdRef = useRef<string | null>(null)
  const activeSessionCode = activeSession?.session_code ?? null

  const pendingQueueItems = useMemo(
    () =>
      queueItems
        .filter((item) => item.status === 'playing' || item.status === 'pending')
        .sort((a, b) => a.queueOrder - b.queueOrder),
    [queueItems],
  )
  const currentQueueItem = pendingQueueItems[0] ?? null
  const guestJoinUrl = useMemo(
    () => buildGuestJoinUrl(window.location.origin, activeSessionCode),
    [activeSessionCode],
  )
  const songSrc =
    currentSong?.videoFile !== null &&
    currentSong?.videoFile !== undefined &&
    currentSong.videoFile !== ''
      ? `/media/songs/${currentSong.videoFile}`
      : ''
  const showMainVideo = songSrc !== '' && !isSongTransitioning
  const progressPct =
    videoDurationSeconds > 0 ? Math.min(100, Math.max(0, (videoPositionSeconds / videoDurationSeconds) * 100)) : 0
  const marqueeTransformStyle =
    marqueeDistancePx > 0 ? { transform: `translateX(-${marqueeOffsetPx}px)` } : undefined
  const isSocketConnected = socketStatus === 'Connected'

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    const container = playerContainerRef.current
    if (container !== null && typeof container.requestFullscreen === 'function') {
      void container.requestFullscreen().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const applyPlayerVolume = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)))
    setPlayerVolumePct(clamped)
    if (clamped > 0) {
      lastNonZeroVolumeRef.current = clamped
    }
    const video = videoRef.current
    if (video !== null) {
      video.volume = clamped / 100
      video.muted = clamped === 0
    }
    const loopVideo = loopVideoRef.current
    if (loopVideo !== null) {
      loopVideo.volume = clamped / 100
      loopVideo.muted = clamped === 0
    }
    setIsPlayerMuted(clamped === 0)
  }, [])

  useEffect(() => {
    if (!hostAllowed) {
      return
    }

    let cancelled = false
    const poll = async () => {
      try {
        const session = await fetchActiveSession()
        if (cancelled) {
          return
        }
        setActiveSession(session)
      } catch (error) {
        if (cancelled) {
          return
        }
        const message = error instanceof Error ? error.message : 'Failed to load active session'
        setSocketStatus(message)
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fetchActiveSession, hostAllowed])

  useEffect(() => {
    if (!hostAllowed || activeSessionCode === null) {
      setPlayerToken(null)
      return
    }

    let cancelled = false
    void loginPlayer()
      .then((token) => {
        if (!cancelled) {
          setPlayerToken(token)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to login player'
          setSocketStatus(message)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionCode, hostAllowed, loginPlayer])

  useEffect(() => {
    if (currentQueueItem === null) {
      setCurrentSong(null)
      resumePositionRef.current = 0
      resumeIsPlayingRef.current = true
      return
    }

    if (
      typeof currentQueueItem.playbackPositionSeconds === 'number' &&
      Number.isFinite(currentQueueItem.playbackPositionSeconds)
    ) {
      resumePositionRef.current = Math.max(0, currentQueueItem.playbackPositionSeconds)
    } else {
      resumePositionRef.current = 0
    }
    if (currentQueueItem.status === 'playing') {
      resumeIsPlayingRef.current = true
    } else if (typeof currentQueueItem.playbackIsPlaying === 'boolean') {
      resumeIsPlayingRef.current = currentQueueItem.playbackIsPlaying
    } else {
      resumeIsPlayingRef.current = true
    }
    if (typeof currentQueueItem.playbackVolumePct === 'number' && Number.isFinite(currentQueueItem.playbackVolumePct)) {
      applyPlayerVolume(currentQueueItem.playbackVolumePct)
    }

    let cancelled = false
    void fetchSongDetail(currentQueueItem.songId, activeSessionCode ?? undefined)
      .then((song) => {
        if (!cancelled) {
          setCurrentSong(song)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentSong(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionCode, applyPlayerVolume, currentQueueItem, fetchSongDetail])

  useEffect(() => {
    const nextId = currentQueueItem?.id ?? null
    const previousId = previousQueueItemIdRef.current
    previousQueueItemIdRef.current = nextId
    if (previousId === null || nextId === null || previousId === nextId) {
      return
    }
    const randomMessage = PLAYER_ENCOURAGEMENTS[Math.floor(Math.random() * PLAYER_ENCOURAGEMENTS.length)]
    setTransitionMessage(randomMessage)
    setIsSongTransitioning(true)
    const timer = window.setTimeout(() => {
      setIsSongTransitioning(false)
    }, 2500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [currentQueueItem?.id])

  useEffect(() => {
    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const closeSocket = () => {
      const current = socketRef.current
      if (current !== null) {
        current.onopen = null
        current.onclose = null
        current.onerror = null
        current.onmessage = null
        current.close()
        socketRef.current = null
      }
    }

    if (!hostAllowed || activeSessionCode === null || playerToken === null) {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
      setQueueItems([])
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
      const wsUrl = buildWSUrl('/ws/player', {
        session_code: activeSessionCode,
        token: playerToken,
      })
      setSocketStatus('Connecting...')
      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setSocketStatus('Connected')
        void fetchSessionQueue(activeSessionCode, playerToken)
          .then((items) => setQueueItems(items))
          .catch(() => undefined)
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
        let incoming: WSIncoming
        try {
          incoming = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }

        if (incoming.type === 'queue.updated') {
          setQueueItems(normalizeSessionQueueItems(incoming.payload.items))
          return
        }

        const video = videoRef.current
        if (video === null) {
          return
        }

        if (incoming.type === 'playback.play') {
          resumeIsPlayingRef.current = true
          void video.play().catch(() => undefined)
          return
        }

        if (incoming.type === 'playback.pause') {
          resumeIsPlayingRef.current = false
          video.pause()
          return
        }

        if (incoming.type === 'playback.seek') {
          const nextPosition = Number(incoming.payload.position_seconds ?? 0)
          if (Number.isFinite(nextPosition)) {
            video.currentTime = Math.max(0, nextPosition)
            resumePositionRef.current = Math.max(0, nextPosition)
          }
          return
        }

        if (incoming.type === 'playback.skip') {
          resumeIsPlayingRef.current = false
          resumePositionRef.current = 0
          video.pause()
          video.currentTime = 0
          return
        }

        if (incoming.type === 'playback.volume') {
          const nextVolume = Number(incoming.payload.volume ?? incoming.payload.volume_pct ?? 100)
          if (Number.isFinite(nextVolume)) {
            const volumePct = Math.max(0, Math.min(100, Math.round(nextVolume > 1 ? nextVolume : nextVolume * 100)))
            applyPlayerVolume(volumePct)
          }
          return
        }

        if (incoming.type === 'session.ended') {
          setActiveSession(null)
          setQueueItems([])
          setCurrentSong(null)
        }
      }
    }

    connectSocket()

    return () => {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
    }
  }, [activeSessionCode, applyPlayerVolume, fetchSessionQueue, hostAllowed, playerToken])

  useEffect(() => {
    const socket = socketRef.current
    const video = videoRef.current
    if (socket === null || video === null || activeSessionCode === null) {
      return
    }

    const interval = window.setInterval(() => {
      const currentSocket = socketRef.current
      const currentVideo = videoRef.current
      if (currentSocket === null || currentSocket.readyState !== WebSocket.OPEN || currentVideo === null) {
        return
      }
      currentSocket.send(
        JSON.stringify({
          type: 'playback.position',
          payload: {
            position_seconds: currentVideo.currentTime,
            duration_seconds: Number.isFinite(currentVideo.duration) ? currentVideo.duration : 0,
            is_playing: !currentVideo.paused,
            volume_pct: Math.round(currentVideo.volume * 100),
          },
        }),
      )
    }, 1000)

    const handleEnded = () => {
      const currentSocket = socketRef.current
      if (currentSocket === null || currentSocket.readyState !== WebSocket.OPEN) {
        return
      }
      currentSocket.send(
        JSON.stringify({
          type: 'playback.ended',
          payload: {},
        }),
      )
    }

    video.addEventListener('ended', handleEnded)
    return () => {
      window.clearInterval(interval)
      video.removeEventListener('ended', handleEnded)
    }
  }, [activeSessionCode, songSrc])

  // Play the song only when both the song URL is known AND the transition has finished
  // (showMainVideo = true). When either condition is false, the video src is '' so the
  // browser stops playback naturally — no need for imperative src clearing.
  useEffect(() => {
    const video = videoRef.current
    if (video === null || !showMainVideo || songSrc === '') {
      return
    }

    const applyResume = () => {
      const nextPosition = resumePositionRef.current
      if (typeof nextPosition === 'number' && Number.isFinite(nextPosition)) {
        const bounded =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(Math.max(0, nextPosition), video.duration)
            : Math.max(0, nextPosition)
        video.currentTime = bounded
      }
      if (resumeIsPlayingRef.current) {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }

    video.addEventListener('loadedmetadata', applyResume)
    applyResume()
    return () => {
      video.removeEventListener('loadedmetadata', applyResume)
    }
  }, [songSrc, showMainVideo])

  // Ensure loop video starts playing on mount (belt-and-suspenders for autoplay policy).
  useEffect(() => {
    const loopVideo = loopVideoRef.current
    if (loopVideo !== null) {
      void loopVideo.play().catch(() => undefined)
    }
  }, [])

  // When not showing the main video, ensure the loop video is playing.
  useEffect(() => {
    if (showMainVideo) {
      return
    }
    const loopVideo = loopVideoRef.current
    if (loopVideo !== null && loopVideo.paused) {
      void loopVideo.play().catch(() => undefined)
    }
  }, [showMainVideo])

  // Retry play when WS connects (or reconnects) and a song is visible.
  // Covers: (1) page refresh where browser autoplay may block the first attempt,
  // (2) WS reconnect where songSrc + showMainVideo haven't changed so the resume
  //     effect won't re-run.
  useEffect(() => {
    if (socketStatus !== 'Connected' || currentSong === null) {
      return
    }
    const video = videoRef.current
    if (video === null) {
      return
    }
    const timer = window.setTimeout(() => {
      if (resumeIsPlayingRef.current && showMainVideo && video.paused && video.src !== '') {
        void video.play().catch(() => undefined)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [socketStatus, currentSong, showMainVideo])

  useEffect(() => {
    const video = videoRef.current
    if (video === null) {
      return
    }

    const syncFromVideo = () => {
      setVideoPositionSeconds(Number.isFinite(video.currentTime) ? video.currentTime : 0)
      setVideoDurationSeconds(Number.isFinite(video.duration) ? video.duration : 0)
      setIsPlayerMuted(video.muted || video.volume === 0)
      setPlayerVolumePct(Math.round((video.muted ? 0 : video.volume) * 100))
    }

    syncFromVideo()
    video.addEventListener('timeupdate', syncFromVideo)
    video.addEventListener('durationchange', syncFromVideo)
    video.addEventListener('loadedmetadata', syncFromVideo)
    video.addEventListener('volumechange', syncFromVideo)
    return () => {
      video.removeEventListener('timeupdate', syncFromVideo)
      video.removeEventListener('durationchange', syncFromVideo)
      video.removeEventListener('loadedmetadata', syncFromVideo)
      video.removeEventListener('volumechange', syncFromVideo)
    }
  }, [])

  useEffect(() => {
    const measureOverflow = () => {
      const viewport = queueViewportRef.current
      const track = queueTrackRef.current
      if (viewport === null || track === null) {
        setMarqueeDistancePx(0)
        setMarqueeOffsetPx(0)
        return
      }
      const overflow = track.scrollWidth - viewport.clientWidth
      if (overflow > 1) {
        setMarqueeDistancePx(overflow)
      } else {
        setMarqueeDistancePx(0)
      }
      setMarqueeOffsetPx(0)
    }

    measureOverflow()
    window.addEventListener('resize', measureOverflow)
    return () => {
      window.removeEventListener('resize', measureOverflow)
    }
  }, [pendingQueueItems, currentSong])

  useEffect(() => {
    if (marqueeDistancePx <= 0) {
      setMarqueeOffsetPx(0)
      return
    }

    let cancelled = false
    let frameHandle: number | null = null
    let timerHandle: number | null = null
    const speedPxPerSecond = 18

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timerHandle = window.setTimeout(() => {
          timerHandle = null
          resolve()
        }, ms)
      })

    const animateToEnd = (): Promise<void> =>
      new Promise((resolve) => {
        const distance = marqueeDistancePx
        const durationMs = Math.max(1000, (distance / speedPxPerSecond) * 1000)
        const started = performance.now()
        const step = (timestamp: number) => {
          if (cancelled) {
            resolve()
            return
          }
          const elapsed = timestamp - started
          const progress = Math.min(1, elapsed / durationMs)
          setMarqueeOffsetPx(distance * progress)
          if (progress >= 1) {
            resolve()
            return
          }
          frameHandle = window.requestAnimationFrame(step)
        }
        frameHandle = window.requestAnimationFrame(step)
      })

    const loop = async () => {
      while (!cancelled) {
        setMarqueeOffsetPx(0)
        await wait(3000)
        if (cancelled) {
          break
        }
        await animateToEnd()
        if (cancelled) {
          break
        }
        await wait(3000)
      }
    }

    void loop()

    return () => {
      cancelled = true
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle)
      }
      if (timerHandle !== null) {
        window.clearTimeout(timerHandle)
      }
    }
  }, [marqueeDistancePx])

  useEffect(() => {
    if (guestJoinUrl === '') {
      setGuestQrDataUrl(null)
      setIsGeneratingGuestQr(false)
      return
    }

    let isCancelled = false
    setIsGeneratingGuestQr(true)
    void QRCode.toDataURL(guestJoinUrl, {
      width: 170,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!isCancelled) {
          setGuestQrDataUrl(url)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setGuestQrDataUrl(null)
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

  if (!hostAllowed) {
    return <PlayerBlockedPage />
  }

  return (
    <main
      className="player-screen"
      ref={playerContainerRef}
      onClick={() => {
        const video = videoRef.current
        if (video !== null && resumeIsPlayingRef.current && video.paused) {
          void video.play().catch(() => undefined)
        }
      }}
    >
      {/* Background loop player — always on, never controlled by admin.
          muted is required for browser autoplay policy without user interaction. */}
      <video
        ref={loopVideoRef}
        className="player-loop-video"
        src="/media/assets/loop.mp4"
        autoPlay
        loop
        muted
        playsInline
        controls={false}
      />

      {/* Main song player — shown only when a song is active and not transitioning.
          src is '' when hidden so the browser stops playback without imperative calls. */}
      <video
        ref={videoRef}
        className={`player-video${showMainVideo ? '' : ' player-video--hidden'}`}
        src={showMainVideo ? songSrc : ''}
        autoPlay
        playsInline
        controls={false}
      />

      <section className="player-overlay player-overlay-top">
        <div className="player-queue-marquee" ref={queueViewportRef}>
          <div className="player-queue-strip" ref={queueTrackRef} style={marqueeTransformStyle}>
            {pendingQueueItems.map((item, index) => (
              <article className="player-queue-card" key={item.id}>
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.title} />
                ) : (
                  <div className="player-queue-card-thumb player-queue-card-thumb--placeholder" />
                )}
                <div className="player-queue-card-copy">
                  <strong>{item.title}</strong>
                  <span>
                    {item.artist} • {item.reservedByUsername ?? 'guest'}
                  </span>
                </div>
                {index === 0 ? (
                  <span className="material-symbols-outlined player-now-playing" aria-label="Now playing">
                    equalizer
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      {showMainVideo ? (
        <section className="player-overlay player-overlay-seek">
          <div className="player-passive-seek-row">
            <input
              className="player-passive-seek"
              type="range"
              min={0}
              max={100}
              value={progressPct}
              style={{ '--range-progress': `${progressPct}%` } as CSSProperties}
              disabled
              readOnly
              aria-label="Playback progress"
            />
            <span className="player-remaining-duration">
              -{formatDurationClock(Math.max(0, videoDurationSeconds - videoPositionSeconds))}
            </span>
          </div>
        </section>
      ) : null}

      {isSongTransitioning && transitionMessage !== '' ? (
        <section className="player-overlay player-overlay-transition">
          <p className="player-transition-text">{transitionMessage}</p>
        </section>
      ) : null}

      {currentQueueItem === null && !isSongTransitioning ? (
        <section className="player-idle-overlay">
          <div className="player-idle-content">
            <p className="player-idle-title">Reserve songs to continue the party!</p>
            <p className="player-idle-subtitle">Scan the QR code below to continue</p>
          </div>
        </section>
      ) : null}

      <section className="player-overlay player-overlay-bottom">
        <article className="player-qr-card">
          <p className="player-qr-session">{activeSessionCode ?? '------'}</p>
          <div className="player-qr-image-shell">
            {guestQrDataUrl ? <img src={guestQrDataUrl} alt="Guest join QR code" /> : null}
            {isGeneratingGuestQr ? <span className="subtitle">Generating QR…</span> : null}
          </div>
          <p className="player-qr-domain">{window.location.hostname}</p>
        </article>
      </section>

      <p className="player-socket-status" aria-label="Player status">
        <span className="material-symbols-outlined" aria-hidden="true">
          {isPlayerMuted ? 'volume_off' : 'volume_up'}
        </span>{' '}
        {isPlayerMuted ? 0 : playerVolumePct}% <span className="player-status-bullet">•</span>{' '}
        <span
          className={`player-connection-dot ${isSocketConnected ? 'connected' : 'disconnected'}`}
          aria-label={isSocketConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
          title={socketStatus}
        />
      </p>
      <button
        type="button"
        className="player-fullscreen-toggle"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
        </span>
      </button>
    </main>
  )
}
