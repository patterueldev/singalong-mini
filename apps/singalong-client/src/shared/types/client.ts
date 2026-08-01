export type UserRole = 'admin' | 'guest' | 'player'

export type UserProfile = {
  id: string
  username: string
  role: UserRole
  created_at: string
  updated_at: string
}

export type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
  message: string
}

export type GuestLoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
  nickname: string
  message: string
}

export type SessionRecord = {
  id: string
  session_code: string
  name: string
  vibes?: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type SessionExistsResponse = {
  exists: boolean
  session_code: string
  name: string | null
}

export type SessionArchiveResponse = {
  session: SessionRecord
  message: string
}

export type SessionQueueListResponse = {
  items: Array<{
    id: string
    session_id: string
    song_id: string
    thumbnail_url: string | null
    title: string
    artist: string
    duration: string | null
    queue_order: number
    status: 'playing' | 'pending' | 'finished' | 'skipped'
    reserved_by: string
    reserved_by_username: string | null
    reserved_at: string
    played_at: string | null
    playback_position_seconds: number | null
    playback_volume_pct: number | null
    playback_is_playing: boolean | null
  }>
}

export type SongQueueItem = {
  id: string
  sessionId: string
  songId: string
  thumbnailUrl: string | null
  title: string
  artist: string
  duration: string | null
  queueOrder: number
  status: 'playing' | 'pending' | 'finished' | 'skipped'
  reservedBy: string
  reservedByUsername: string | null
  reservedAt: string
  playedAt: string | null
  playbackPositionSeconds: number | null
  playbackVolumePct: number | null
  playbackIsPlaying: boolean | null
}

export type DownloadProgressItem = {
  songId: string
  title: string
  artist: string
  duration: string | null
  addedByUsername: string | null
  sourceThumbnail: string | null
  status: 'pending' | 'downloading' | 'error' | 'cancelled'
  progressPct: number | null
  progressMessage: string | null
  errorMessage: string | null
}

export type SongDownloadListResponse = {
  items: Array<{
    song_id: string
    title: string
    artist: string
    duration: string | null
    added_by_username: string | null
    source_thumbnail: string | null
    source_id: string | null
    source_url: string
    status: string
    progress_pct: number | null
    current_step: string | null
    progress_message: string | null
    error_message: string | null
    added_at: string
    started_at: string | null
    completed_at: string | null
    updated_at: string
  }>
}

export type SongDownloadRetryResponse = {
  status: string
  message: string
  song_id: string
}

export type SongbookSong = {
  id: string
  title: string
  artist: string
  status: string
  addedAt: string
  language: string | null
  duration: string
  genre: string | null
  tags: string[]
  thumbnailUrl: string | null
  sourceId: string | null
  sourceUrl: string | null
  videoFile: string | null
  lyrics: string | null
  isOffVocal: boolean
  videoHasLyrics: boolean
  addedByUsername: string | null
  queuedCountInSession: number
  wasQueuedInSession: boolean
  qualityScore: number
  qualityFlags: SongQualityFlag[]
  validatedByAdmin: boolean
  enhancementStatus: string | null
}

export type TrimHistoryItem = {
  id: string
  trim_start_ms: number
  trim_end_ms: number
  old_duration_ms: number | null
  new_duration_ms: number | null
  status: 'completed' | 'failed' | 'restored'
  backup_expires_at: string | null
  created_at: string
  can_restore: boolean
}

export type TrimResponse = {
  message: string
  song: SongbookSong
}

export type RestoreResponse = {
  message: string
  song: SongbookSong
}

export type SongQualityFlag = {
  code: string
  label: string
  message: string
  points: number
  severity: 'low' | 'medium' | 'high'
}

export type SessionParticipant = {
  userId: string
  username: string
  pendingCount: number
  finishedCount: number
  skippedCount: number
  totalCount: number
  isOnline: boolean
}

export type SessionWorkspace = {
  session: SessionRecord
  websocketStatus: string
  playerConnected: boolean
  adminConnectedCount: number
  guestConnectedCount: number
}

export type SongbookListResponse = {
  items: SongbookSong[]
  total: number
  page: number
  pages: number
}

export type SuggestResult = {
  id: string
  title: string
  channelName: string
  channelUrl: string
  thumbnailUrl: string
  duration: string
  description: string
  viewCount: number | null
  uploadedAt: string
  existsInSongbook: boolean | null
  existingSongId: string | null
  sourceUrl: string
  youtubeId: string
}

export type SuggestSearchResponse = {
  effective_query: string
  appended_karaoke: boolean
  results: Array<{
    id: string
    title: string
    channel_name: string
    channel_url: string
    thumbnail_url: string
    duration: string
    description: string
    view_count: number | null
    uploaded_at: string
    exists_in_songbook: boolean | null
    existing_song_id: string | null
    source_url: string
    youtube_id: string
  }>
}

export type SuggestDuplicateMatch = {
  song_id: string
  title: string
  artist: string
  status: string
  is_archived: boolean
  source_id: string | null
  source_url: string | null
  thumbnail_url: string | null
  score: number
  title_score: number
  artist_score: number | null
  confidence: 'exact' | 'high' | 'possible'
  reasons: string[]
}

export type SongDuplicateGroupMember = {
  song_id: string
  title: string
  artist: string
  status: string
  is_archived: boolean
  source_id: string | null
  source_url: string | null
  thumbnail_url: string | null
  added_at: string | null
}

export type SongDuplicateGroupEdge = {
  song_id_a: string
  song_id_b: string
  score: number
  title_score: number
  artist_score: number | null
  confidence: 'exact' | 'high' | 'possible'
  reasons: string[]
}

export type SongDuplicateGroup = {
  group_id: string
  tier: 'exact' | 'high' | 'possible'
  members: SongDuplicateGroupMember[]
  edges: SongDuplicateGroupEdge[]
}

export type SongDuplicateAuditResponse = {
  groups: SongDuplicateGroup[]
  total_songs_scanned: number
  generated_at: string
}

export type SuggestIdentifyResponse = {
  source_url: string
  source_id: string
  source: string
  source_thumbnail: string
  title: string
  artist: string
  language: string | null
  is_off_vocal: boolean
  video_has_lyrics: boolean
  genre: string | null
  tags: string[] | null
  lyrics: string | null
  is_likely_song: boolean
  content_confidence: number
  content_notice: string | null
  duplicate_matches: SuggestDuplicateMatch[]
}

export type SuggestEnhanceResponse = {
  status: string
  message: string
  enhanced: SuggestIdentifyResponse
}

export type SuggestMetadataSuggestionsResponse = {
  genres: string[]
  tags: string[]
}

export type SuggestDraft = {
  source_url: string
  source_id: string
  source: string
  source_thumbnail: string
  title: string
  artist: string
  language: string
  is_off_vocal: boolean
  video_has_lyrics: boolean
  genre: string
  tags: string[]
  lyrics: string
  source_thumbnail_data_url: string
  isEnhanced?: boolean
  isLikelySong?: boolean
  contentConfidence?: number
  contentNotice?: string | null
  possibleDuplicates?: SuggestDuplicateMatch[]
}

export type LanguageCode = 'en' | 'ja' | 'ko' | 'zh' | 'other'

export type PlaybackState = {
  isPlaying: boolean
  positionSeconds: number
  durationSeconds: number
}

export type StoredAuth = {
  accessToken: string
  user: UserProfile
}

export type GuestAuth = {
  accessToken: string
  nickname: string
  user: UserProfile
}

export type WSIncoming = {
  type: string
  session_code: string
  payload: Record<string, unknown>
}
