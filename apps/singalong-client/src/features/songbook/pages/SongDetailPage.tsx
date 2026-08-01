import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchSongDetail } from '../../admin/services/adminService'
import type { SongbookSong } from '../../../shared/types/client'
import { SongDetailsModal } from '../components/SongDetailsModal'

export function SongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    fetchSongDetail(id)
      .then((s) => {
        setSong(s)
        setIsLoading(false)
      })
      .catch(() => {
        setError('Song not found.')
        setIsLoading(false)
      })
  }, [id])

  return (
    <SongDetailsModal
      isOpen
      song={song}
      isLoading={isLoading}
      errorMessage={error}
      onClose={() => navigate('/songbook')}
      shareUrl={id ? `${window.location.origin}/songbook/song/${id}` : undefined}
    />
  )
}
