import { apiJson, ApiError } from '../../../shared/api/httpClient'
import type {
  SessionArchiveResponse,
  SessionParticipant,
  SessionQueueListResponse,
  SessionRecord,
  SessionWorkspace,
  SongDownloadRetryResponse,
  SongDuplicateAuditResponse,
  SongQualityFlag,
  SongbookListResponse,
  SongbookSong,
  SuggestIdentifyResponse,
  TrimHistoryItem,
  TrimResponse,
  RestoreResponse,
  UserProfile,
} from '../../../shared/types/client'
import { normalizeSessionQueueItems } from '../../shared/services/queueTransforms'

export interface AdminService {
  fetchSongbook: (page?: number, limit?: number, sessionCode?: string, sessionId?: string, includeUnpublished?: boolean) => Promise<SongbookListResponse>
  searchSongbook: (q: string, page?: number, limit?: number, sessionCode?: string, sessionId?: string, includeUnpublished?: boolean) => Promise<SongbookListResponse>
  fetchSongDetail: (id: string, sessionCode?: string, sessionId?: string) => Promise<SongbookSong>
  fetchSessionQueue: (sessionCode: string, token: string) => Promise<ReturnType<typeof normalizeSessionQueueItems>>
  fetchSessionWorkspace: (sessionCode: string, token: string) => Promise<SessionWorkspace>
  fetchSessionParticipants: (sessionCode: string, token: string) => Promise<SessionParticipant[]>
  updateSessionMetadata: (sessionId: string, token: string, payload: { name?: string; vibes?: string }) => Promise<SessionRecord>
  updateSongAdminDetails: (
    songId: string,
    token: string,
    payload: {
      title: string
      artist: string
      language: string | null
      genre: string | null
      tags: string[]
      lyrics: string | null
      is_off_vocal: boolean
      video_has_lyrics: boolean
      source_thumbnail_data_url?: string | null
    },
  ) => Promise<SongbookSong>
  setSongValidation: (songId: string, token: string, validated: boolean) => Promise<SongbookSong>
  trimSong: (songId: string, token: string, startMs: number, endMs: number, monitorId?: string) => Promise<TrimResponse>
  getTrimHistory: (songId: string, token: string) => Promise<TrimHistoryItem[]>
  getTrimProgress: (songId: string, monitorId: string, token: string) => Promise<{ operation_id: string; status: string; progress_percent: number; message: string; error: string | null }>
  restoreTrim: (songId: string, token: string, historyId: string) => Promise<RestoreResponse>
  fixDuration: (songId: string, token: string) => Promise<{ song_id: string; old_duration: string; new_duration: string; status: string; message: string }>
  enhanceSong: (songId: string, token: string) => Promise<{ status: string; message: string; enhanced: SuggestIdentifyResponse }>
  queueSongEnhancement: (songId: string, token: string) => Promise<{ status: string; message: string; song_id: string }>
  reserveSessionQueueSong: (
    sessionCode: string,
    songId: string,
    token: string,
    reservedForNickname?: string,
  ) => Promise<void>
  removeQueueItem: (sessionCode: string, queueItemId: string, token: string) => Promise<void>
  listSessions: (token: string) => Promise<SessionRecord[]>
  fetchCurrentUser: (token: string) => Promise<UserProfile>
  createSession: (name: string, token: string) => Promise<SessionRecord>
  archiveSession: (sessionId: string, token: string) => Promise<SessionArchiveResponse>
  archiveSong: (songId: string, token: string) => Promise<{ message: string }>
  fetchActiveSession: () => Promise<SessionRecord | null>
  retryDownload: (songId: string, token: string) => Promise<SongDownloadRetryResponse>
  stopDownload: (songId: string, token: string) => Promise<SongDownloadRetryResponse>
  fetchDuplicateAudit: (token: string) => Promise<SongDuplicateAuditResponse>
  dismissDuplicatePair: (songIdA: string, songIdB: string, token: string) => Promise<{ message: string }>
  mergeDuplicatePair: (keepSongId: string, removeSongId: string, token: string) => Promise<{ message: string; repointed_queue_rows: number }>
}

function mapSong(raw: {
  id: string; title: string; artist: string; status: string; created_at: string; duration: string
  language: string | null; genre: string | null; tags: string[]
  thumbnail_url: string | null; source_id: string | null; source_url: string | null
  video_file: string | null; lyrics: string | null; added_by_username: string | null
  is_off_vocal?: boolean; video_has_lyrics?: boolean
  queued_count_in_session?: number; was_queued_in_session?: boolean
  quality_score?: number; quality_flags?: SongQualityFlag[]
  validated_by_admin?: boolean
  enhancement_status?: string | null
}): SongbookSong {
  return {
    id: raw.id,
    title: raw.title,
    artist: raw.artist,
    status: raw.status,
    addedAt: raw.created_at,
    duration: raw.duration,
    language: raw.language,
    genre: raw.genre,
    tags: raw.tags,
    thumbnailUrl: raw.thumbnail_url,
    sourceId: raw.source_id,
    sourceUrl: raw.source_url,
    videoFile: raw.video_file,
    lyrics: raw.lyrics,
    isOffVocal: raw.is_off_vocal === true,
    videoHasLyrics: raw.video_has_lyrics === true,
    addedByUsername: raw.added_by_username,
    queuedCountInSession: typeof raw.queued_count_in_session === 'number' ? raw.queued_count_in_session : 0,
    wasQueuedInSession: raw.was_queued_in_session === true,
    qualityScore: typeof raw.quality_score === 'number' ? raw.quality_score : 0,
    qualityFlags: Array.isArray(raw.quality_flags) ? raw.quality_flags : [],
    validatedByAdmin: raw.validated_by_admin === true,
    enhancementStatus: raw.enhancement_status ?? null,
  }
}

export async function fetchSongbook(
  page: number = 1,
  limit: number = 20,
  sessionCode?: string,
  sessionId?: string,
  includeUnpublished: boolean = false,
): Promise<SongbookListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (includeUnpublished) {
    params.set('include_unpublished', 'true')
  }
  if (typeof sessionId === 'string' && sessionId !== '') {
    params.set('sessionId', sessionId)
  }
  if (typeof sessionCode === 'string' && sessionCode !== '') {
    params.set('session_code', sessionCode)
  }
  const raw = await apiJson<{
    items: Array<{
      id: string; title: string; artist: string; status: string; created_at: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
      is_off_vocal?: boolean; video_has_lyrics?: boolean
      queued_count_in_session?: number; was_queued_in_session?: boolean
      quality_score?: number; quality_flags?: SongQualityFlag[]; validated_by_admin?: boolean
      enhancement_status?: string | null
    }>
    total: number; page: number; pages: number
  }>(`/songs?${params.toString()}`)

  return {
    ...raw,
    items: raw.items.map(mapSong),
  }
}

export async function searchSongbook(
  q: string,
  page: number = 1,
  limit: number = 20,
  sessionCode?: string,
  sessionId?: string,
  includeUnpublished: boolean = false,
): Promise<SongbookListResponse> {
  const params = new URLSearchParams({ q, page: String(page), limit: String(limit) })
  if (includeUnpublished) {
    params.set('include_unpublished', 'true')
  }
  if (typeof sessionId === 'string' && sessionId !== '') {
    params.set('sessionId', sessionId)
  }
  if (typeof sessionCode === 'string' && sessionCode !== '') {
    params.set('session_code', sessionCode)
  }
  const raw = await apiJson<{
    items: Array<{
      id: string; title: string; artist: string; status: string; created_at: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
      is_off_vocal?: boolean; video_has_lyrics?: boolean
      queued_count_in_session?: number; was_queued_in_session?: boolean
      quality_score?: number; quality_flags?: SongQualityFlag[]; validated_by_admin?: boolean
      enhancement_status?: string | null
    }>
    total: number; page: number; pages: number
  }>(`/songs/search?${params.toString()}`)

  return {
    ...raw,
    items: raw.items.map(mapSong),
  }
}

export async function fetchSongDetail(id: string, sessionCode?: string, sessionId?: string): Promise<SongbookSong> {
  const params = new URLSearchParams()
  if (typeof sessionId === 'string' && sessionId !== '') {
    params.set('sessionId', sessionId)
  }
  if (typeof sessionCode === 'string' && sessionCode !== '') {
    params.set('session_code', sessionCode)
  }
  const suffix = params.toString()
  const raw = await apiJson<{
    id: string; title: string; artist: string; status: string; created_at: string; duration: string
    language: string | null; genre: string | null; tags: string[]
    thumbnail_url: string | null; source_id: string | null; source_url: string | null
    video_file: string | null; lyrics: string | null; added_by_username: string | null
    is_off_vocal?: boolean; video_has_lyrics?: boolean
    queued_count_in_session?: number; was_queued_in_session?: boolean
    quality_score?: number; quality_flags?: SongQualityFlag[]; validated_by_admin?: boolean
    enhancement_status?: string | null
  }>(`/songs/${id}${suffix ? `?${suffix}` : ''}`)
  return mapSong(raw)
}

export async function fetchSessionQueue(sessionCode: string, token: string) {
  const payload = await apiJson<SessionQueueListResponse>(`/sessions/${sessionCode}/queue`, {}, token)
  return normalizeSessionQueueItems(payload.items)
}

export async function fetchSessionWorkspace(sessionCode: string, token: string): Promise<SessionWorkspace> {
  const raw = await apiJson<{
    session: SessionRecord
    websocket_status: string
    player_connected: boolean
    admin_connected_count: number
    guest_connected_count: number
  }>(`/sessions/${sessionCode}/workspace`, {}, token)
  return {
    session: raw.session,
    websocketStatus: raw.websocket_status,
    playerConnected: raw.player_connected,
    adminConnectedCount: raw.admin_connected_count,
    guestConnectedCount: raw.guest_connected_count,
  }
}

export async function fetchSessionParticipants(sessionCode: string, token: string): Promise<SessionParticipant[]> {
  const raw = await apiJson<{
    items: Array<{
      user_id: string
      username: string
      pending_count: number
      finished_count: number
      skipped_count: number
      total_count: number
      is_online: boolean
    }>
  }>(`/sessions/${sessionCode}/participants`, {}, token)
  return raw.items.map((item) => ({
    userId: item.user_id,
    username: item.username,
    pendingCount: item.pending_count,
    finishedCount: item.finished_count,
    skippedCount: item.skipped_count,
    totalCount: item.total_count,
    isOnline: item.is_online,
  }))
}

export function updateSessionMetadata(
  sessionId: string,
  token: string,
  payload: { name?: string; vibes?: string },
): Promise<SessionRecord> {
  return apiJson<SessionRecord>(
    `/sessions/${sessionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export async function updateSongAdminDetails(
  songId: string,
  token: string,
  payload: {
    title: string
    artist: string
    language: string | null
    genre: string | null
    tags: string[]
    lyrics: string | null
    source_thumbnail_data_url?: string | null
  },
): Promise<SongbookSong> {
  const raw = await apiJson<{
    item: {
      id: string; title: string; artist: string; status: string; created_at: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
      is_off_vocal?: boolean; video_has_lyrics?: boolean
      queued_count_in_session?: number; was_queued_in_session?: boolean
      quality_score?: number; quality_flags?: SongQualityFlag[]; validated_by_admin?: boolean
      enhancement_status?: string | null
    }
    message: string
  }>(
    `/songs/${songId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    token,
  )

  return mapSong(raw.item)
}

export async function archiveSong(songId: string, token: string): Promise<{ message: string }> {
  return apiJson<{ message: string }>(`/songs/${songId}/archive`, { method: 'PATCH' }, token)
}

export async function setSongValidation(
  songId: string,
  token: string,
  validated: boolean,
): Promise<SongbookSong> {
  const raw = await apiJson<{
    item: {
      id: string; title: string; artist: string; status: string; created_at: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
      is_off_vocal?: boolean; video_has_lyrics?: boolean
      queued_count_in_session?: number; was_queued_in_session?: boolean
      quality_score?: number; quality_flags?: SongQualityFlag[]; validated_by_admin?: boolean
      enhancement_status?: string | null
    }
    message: string
  }>(
    `/songs/${songId}/validation`,
    {
      method: 'PATCH',
      body: JSON.stringify({ validated }),
    },
    token,
  )

  return mapSong(raw.item)
}

export async function reserveSessionQueueSong(
  sessionCode: string,
  songId: string,
  token: string,
  reservedForNickname?: string,
): Promise<void> {
  await apiJson<{ message: string }>(
    `/sessions/${sessionCode}/queue`,
    {
      method: 'POST',
      body: JSON.stringify({
        song_id: songId,
        reserved_for_nickname:
          typeof reservedForNickname === 'string' && reservedForNickname.trim() !== ''
            ? reservedForNickname.trim()
            : undefined,
      }),
    },
    token,
  )
}

export async function removeQueueItem(sessionCode: string, queueItemId: string, token: string): Promise<void> {
  await apiJson<{ message: string }>(`/sessions/${sessionCode}/queue/${queueItemId}`, { method: 'DELETE' }, token)
}

export function listSessions(token: string): Promise<SessionRecord[]> {
  return apiJson<SessionRecord[]>('/sessions', {}, token)
}

export function fetchCurrentUser(token: string): Promise<UserProfile> {
  return apiJson<UserProfile>('/users/me', {}, token)
}

export function createSession(name: string, token: string): Promise<SessionRecord> {
  return apiJson<SessionRecord>('/sessions', { method: 'POST', body: JSON.stringify({ name }) }, token)
}

export function archiveSession(sessionId: string, token: string): Promise<SessionArchiveResponse> {
  return apiJson<SessionArchiveResponse>(`/sessions/${sessionId}/archive`, { method: 'PATCH' }, token)
}

export async function fetchActiveSession(): Promise<SessionRecord | null> {
  try {
    return await apiJson<SessionRecord>('/sessions/active')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null
    }
    throw error
  }
}

export async function trimSong(songId: string, token: string, startMs: number, endMs: number, monitorId?: string): Promise<TrimResponse> {
  return apiJson<TrimResponse>(
    `/songs/${songId}/trim`,
    {
      method: 'POST',
      body: JSON.stringify({
        trim_start_ms: startMs,
        trim_end_ms: endMs,
        monitor_id: monitorId,
      }),
    },
    token,
  )
}

export async function getTrimHistory(songId: string, token: string): Promise<TrimHistoryItem[]> {
  const raw = await apiJson<{ items: TrimHistoryItem[] }>(`/songs/${songId}/trim-history`, {}, token)
  return raw.items
}

export async function getTrimProgress(
  songId: string,
  monitorId: string,
  token: string,
): Promise<{ operation_id: string; status: string; progress_percent: number; message: string; error: string | null }> {
  return apiJson(
    `/songs/${songId}/trim-progress/${monitorId}`,
    {},
    token,
  )
}

export async function restoreTrim(songId: string, token: string, historyId: string): Promise<RestoreResponse> {
  return apiJson<RestoreResponse>(
    `/songs/${songId}/trim/restore`,
    {
      method: 'POST',
      body: JSON.stringify({
        trim_history_id: historyId,
      }),
    },
    token,
  )
}

export async function fixDuration(songId: string, token: string): Promise<{
  song_id: string
  old_duration: string
  new_duration: string
  status: string
  message: string
}> {
  return apiJson<{
    song_id: string
    old_duration: string
    new_duration: string
    status: string
    message: string
  }>(
    `/songs/${songId}/fix-duration`,
    {
      method: 'POST',
    },
    token,
  )
}

export async function enhanceSong(songId: string, token: string): Promise<{
  status: string
  message: string
  enhanced: SuggestIdentifyResponse
}> {
  return apiJson<{
    status: string
    message: string
    enhanced: SuggestIdentifyResponse
  }>(
    `/songs/${songId}/enhance`,
    {
      method: 'POST',
    },
    token,
  )
}

export async function queueSongEnhancement(songId: string, token: string): Promise<{
  status: string
  message: string
  song_id: string
}> {
  return apiJson<{
    status: string
    message: string
    song_id: string
  }>(
    `/songs/${songId}/enhance/queue`,
    {
      method: 'POST',
    },
    token,
  )
}

export async function retryDownload(songId: string, token: string): Promise<SongDownloadRetryResponse> {
  return apiJson<SongDownloadRetryResponse>(`/songs/downloads/${songId}/retry`, { method: 'POST' }, token)
}

export async function stopDownload(songId: string, token: string): Promise<SongDownloadRetryResponse> {
  return apiJson<SongDownloadRetryResponse>(`/songs/downloads/${songId}/stop`, { method: 'POST' }, token)
}

export async function fetchDuplicateAudit(token: string): Promise<SongDuplicateAuditResponse> {
  return apiJson<SongDuplicateAuditResponse>('/songs/duplicates/audit', {}, token)
}

export async function dismissDuplicatePair(songIdA: string, songIdB: string, token: string): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    '/songs/duplicates/dismiss',
    { method: 'POST', body: JSON.stringify({ song_id_a: songIdA, song_id_b: songIdB }) },
    token,
  )
}

export async function mergeDuplicatePair(
  keepSongId: string,
  removeSongId: string,
  token: string,
): Promise<{ message: string; repointed_queue_rows: number }> {
  return apiJson<{ message: string; repointed_queue_rows: number }>(
    '/songs/duplicates/merge',
    { method: 'POST', body: JSON.stringify({ keep_song_id: keepSongId, remove_song_id: removeSongId }) },
    token,
  )
}

export const adminService: AdminService = {
  fetchSongbook,
  searchSongbook,
  fetchSongDetail,
  fetchSessionQueue,
  fetchSessionWorkspace,
  fetchSessionParticipants,
  updateSessionMetadata,
  updateSongAdminDetails,
  reserveSessionQueueSong,
  removeQueueItem,
  listSessions,
  fetchCurrentUser,
  createSession,
  archiveSession,
  archiveSong,
  setSongValidation,
  fetchActiveSession,
  trimSong,
  getTrimHistory,
  getTrimProgress,
  restoreTrim,
  fixDuration,
  enhanceSong,
  queueSongEnhancement,
  retryDownload,
  stopDownload,
  fetchDuplicateAudit,
  dismissDuplicatePair,
  mergeDuplicatePair,
}
