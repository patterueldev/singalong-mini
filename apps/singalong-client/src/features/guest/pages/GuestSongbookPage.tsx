import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { SongbookListItem } from '../../songbook/components/SongbookListItem'
import { adminService } from '../../admin/services/adminService'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestReserveSong } from '../services/guestService'
import { isValidSessionCode } from '../../../shared/lib/validation'
import type { SongbookSong } from '../../../shared/types/client'

export function GuestSongbookPage() {
  const navigate = useNavigate()
  const { guestAuth, sessionCode, hasGuestSession } = useGuestSession()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setPage(1)
  }, [debouncedQuery])

  useEffect(() => {
    if (!hasGuestSession || !isValidSessionCode(sessionCode)) {
      setSongs([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage('')

    const trimmed = debouncedQuery.trim()
    const request =
      trimmed === ''
        ? adminService.fetchSongbook(page, 20, sessionCode)
        : adminService.searchSongbook(trimmed, page, 20, sessionCode)

    void request
      .then((payload) => {
        if (cancelled) {
          return
        }
        setSongs(payload.items)
        setPages(payload.pages)
      })
      .catch((error) => {
        if (!cancelled) {
          setSongs([])
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load songbook')
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
  }, [debouncedQuery, hasGuestSession, page, sessionCode])

  const activeSongbookCount = useMemo(() => songs.length, [songs])

  if (!hasGuestSession || !isValidSessionCode(sessionCode) || guestAuth === null) {
    return <Navigate to="/guest/join" replace />
  }

  const handleReserve = async (songId: string) => {
    setErrorMessage('')
    try {
      await guestReserveSong(sessionCode, songId, guestAuth.accessToken)
      setMessage('Song reserved.')
      navigate('/guest/home', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reserve song')
    }
  }

  return (
    <main className="app-shell guest-shell">
      <section className="card guest-home-card">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            <p className="subtitle">
              Session <strong>{sessionCode}</strong> · {guestAuth.nickname}
            </p>
          </div>
          <button type="button" className="secondary" onClick={() => navigate('/guest/home')}>
            Back
          </button>
        </div>

        {message !== '' ? <p className="success-message top-gap">{message}</p> : null}
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}

        <div className="form top-gap">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songbook" />
        </div>

        <div className="top-gap">
          {isLoading ? (
            <p className="empty-state">Loading songbook…</p>
          ) : activeSongbookCount === 0 ? (
            <p className="empty-state">No songs found.</p>
          ) : (
            <div className="queue-list songbook-list">
              {songs.map((song) => (
                <article key={song.id} className="songbook-guest-item">
                  <SongbookListItem song={song} onClick={() => navigate(`/guest/song/${song.id}`)} />
                  <div className="row-actions top-gap">
                    <button type="button" className="secondary small" onClick={() => navigate(`/guest/song/${song.id}`)}>
                      Details
                    </button>
                    <button type="button" className="small" onClick={() => void handleReserve(song.id)}>
                      Reserve
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {pages > 1 ? (
          <div className="pagination songbook-pagination top-gap">
            <button type="button" className="pagination-arrow-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              ‹
            </button>
            <span className="pagination-info">
              Page {page} / {pages}
            </span>
            <button type="button" className="pagination-arrow-button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>
              ›
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
