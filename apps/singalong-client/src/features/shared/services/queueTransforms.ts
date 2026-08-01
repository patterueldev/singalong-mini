import type { DownloadProgressItem, SongQueueItem } from '../../../shared/types/client'

export function normalizeDownloadProgressItems(payload: unknown): DownloadProgressItem[] {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const raw = entry as Record<string, unknown>
    const songId = typeof raw.song_id === 'string' ? raw.song_id : null
    const title = typeof raw.title === 'string' ? raw.title : null
    const artist = typeof raw.artist === 'string' ? raw.artist : null
    const status =
      raw.status === 'pending' ||
      raw.status === 'downloading' ||
      raw.status === 'error' ||
      raw.status === 'cancelled'
        ? raw.status
        : null
    if (songId === null || title === null || artist === null || status === null) {
      return []
    }

    return [
      {
        songId,
        title,
        artist,
        duration: typeof raw.duration === 'string' && raw.duration !== '' ? raw.duration : null,
        addedByUsername:
          typeof raw.added_by_username === 'string' && raw.added_by_username !== ''
            ? raw.added_by_username
            : null,
        sourceThumbnail:
          typeof raw.source_thumbnail === 'string' && raw.source_thumbnail !== ''
            ? raw.source_thumbnail
            : null,
        status,
        progressPct: typeof raw.progress_pct === 'number' ? raw.progress_pct : null,
        progressMessage: typeof raw.progress_message === 'string' ? raw.progress_message : null,
        errorMessage: typeof raw.error_message === 'string' ? raw.error_message : null,
      },
    ]
  })
}

export function normalizeSessionQueueItems(payload: unknown): SongQueueItem[] {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const raw = entry as Record<string, unknown>
    const status =
      raw.status === 'playing' || raw.status === 'pending' || raw.status === 'finished' || raw.status === 'skipped'
        ? raw.status
        : null
    if (
      typeof raw.id !== 'string' ||
      typeof raw.session_id !== 'string' ||
      typeof raw.song_id !== 'string' ||
      typeof raw.title !== 'string' ||
      typeof raw.artist !== 'string' ||
      typeof raw.queue_order !== 'number' ||
      status === null ||
      typeof raw.reserved_by !== 'string' ||
      typeof raw.reserved_at !== 'string'
    ) {
      return []
    }

    return [
      {
        id: raw.id,
        sessionId: raw.session_id,
        songId: raw.song_id,
        thumbnailUrl:
          typeof raw.thumbnail_url === 'string' && raw.thumbnail_url !== ''
            ? raw.thumbnail_url
            : null,
        title: raw.title,
        artist: raw.artist,
        duration: typeof raw.duration === 'string' && raw.duration !== '' ? raw.duration : null,
        queueOrder: raw.queue_order,
        status,
        reservedBy: raw.reserved_by,
        reservedByUsername:
          typeof raw.reserved_by_username === 'string' && raw.reserved_by_username !== ''
            ? raw.reserved_by_username
            : null,
        reservedAt: raw.reserved_at,
        playedAt: typeof raw.played_at === 'string' && raw.played_at !== '' ? raw.played_at : null,
        playbackPositionSeconds:
          typeof raw.playback_position_seconds === 'number' && Number.isFinite(raw.playback_position_seconds)
            ? raw.playback_position_seconds
            : null,
        playbackVolumePct:
          typeof raw.playback_volume_pct === 'number' && Number.isFinite(raw.playback_volume_pct)
            ? raw.playback_volume_pct
            : null,
        playbackIsPlaying: typeof raw.playback_is_playing === 'boolean' ? raw.playback_is_playing : null,
      },
    ]
  })
}

export function mergeDownloadProgressItems(
  previous: DownloadProgressItem[],
  incoming: DownloadProgressItem[],
): DownloadProgressItem[] {
  const previousBySongId = new Map(previous.map((item) => [item.songId, item]))
  return incoming.map((item) => {
    const previousItem = previousBySongId.get(item.songId)
    if (previousItem === undefined) {
      return item
    }

    return {
      ...item,
      progressPct: item.progressPct ?? previousItem.progressPct,
      duration: item.duration ?? previousItem.duration,
    }
  })
}
