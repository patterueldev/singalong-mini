import type { SongbookSong, StoredAuth } from '../../../shared/types/client'

interface SongTrimModalProps {
  song: SongbookSong
  isOpen: boolean
  auth: StoredAuth
  onClose: () => void
  onTrimComplete: () => void
}

export function SongTrimModal({ song, isOpen, onClose }: SongTrimModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trim Video: {song.title}</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p>This is a test modal for {song.title}</p>
        </div>
      </div>
    </div>
  )
}
