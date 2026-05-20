import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import './App.css'

type UserRole = 'admin' | 'guest' | 'player'

type UserProfile = {
  id: string
  username: string
  role: UserRole
  created_at: string
  updated_at: string
}

type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
  message: string
}

type GuestLoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
  nickname: string
  message: string
}

type SessionRecord = {
  id: string
  session_code: string
  name: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

type SessionArchiveResponse = {
  session: SessionRecord
  message: string
}

type SongQueueItem = {
  id: string
  title: string
  artist: string
  status: string
}

type DownloadProgressItem = {
  songId: string
  title: string
  artist: string
  duration: string | null
  addedByUsername: string | null
  sourceThumbnail: string | null
  status: 'pending' | 'downloading' | 'error'
  progressPct: number | null
  progressMessage: string | null
  errorMessage: string | null
}

type SongDownloadRetryResponse = {
  status: string
  message: string
  song_id: string
}

type SongbookSong = {
  id: string
  title: string
  artist: string
  language: string | null
  duration: string
  genre: string | null
  tags: string[]
  thumbnailUrl: string | null
  sourceId: string | null
  sourceUrl: string | null
  videoFile: string | null
  lyrics: string | null
  addedByUsername: string | null
}

type SongbookListResponse = {
  items: SongbookSong[]
  total: number
  page: number
  pages: number
}

type SuggestResult = {
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
  sourceUrl: string
  youtubeId: string
}

type SuggestSearchResponse = {
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
    source_url: string
    youtube_id: string
  }>
}

type SuggestIdentifyResponse = {
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
}

type SuggestEnhanceResponse = {
  status: string
  message: string
  enhanced: SuggestIdentifyResponse
}

type SuggestMetadataSuggestionsResponse = {
  genres: string[]
  tags: string[]
}

type SuggestDraft = {
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
}

type PlaybackState = {
  isPlaying: boolean
  positionSeconds: number
}

type StoredAuth = {
  accessToken: string
  user: UserProfile
}

type GuestAuth = {
  accessToken: string
  nickname: string
  user: UserProfile
}

type WSIncoming = {
  type: string
  session_code: string
  payload: Record<string, unknown>
}

const AUTH_STORAGE_KEY = 'singalong-client-admin-auth'
const SUGGEST_STORAGE_KEY = 'singalong-client-suggest-nickname'
const SUGGEST_AUTH_STORAGE_KEY = 'singalong-client-suggest-auth'
const SUGGEST_DRAFT_STORAGE_KEY = 'singalong-client-suggest-draft'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin
const API_ROOT =
  API_BASE_URL.endsWith('/api') || API_BASE_URL.endsWith('/api/')
    ? API_BASE_URL.replace(/\/$/, '')
    : `${API_BASE_URL.replace(/\/$/, '')}/api`
const HTTP_BASE = API_ROOT.replace(/\/api$/, '')
const WS_BASE = HTTP_BASE.replace(/^http/i, 'ws')

const INITIAL_MOCK_QUEUE: SongQueueItem[] = [
  { id: 'mock-1', title: 'Bohemian Rhapsody', artist: 'Queen', status: 'queued' },
  { id: 'mock-2', title: 'Dancing Queen', artist: 'ABBA', status: 'queued' },
]



const NICKNAME_REGEX = /^[A-Za-z0-9_]+$/
const SUGGEST_KEYWORD_REGEX = /\b(karaoke|instrumental|off[\s-]?vocal)\b/i
const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,}|youtu\.be\/[A-Za-z0-9_-]{6,})([^\s]*)$/i

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function readStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken !== '' &&
      typeof parsed.user?.username === 'string'
    ) {
      return {
        accessToken: parsed.accessToken,
        user: parsed.user as UserProfile,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY)
  return null
}

function saveStoredAuth(auth: StoredAuth) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
}

function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}

function isValidSuggestNickname(value: string): boolean {
  return NICKNAME_REGEX.test(value)
}

function readSuggestNickname(): string {
  const value = window.localStorage.getItem(SUGGEST_STORAGE_KEY) ?? ''
  return isValidSuggestNickname(value) ? value : ''
}

function saveSuggestNickname(nickname: string) {
  window.localStorage.setItem(SUGGEST_STORAGE_KEY, nickname)
}

function clearSuggestNickname() {
  window.localStorage.removeItem(SUGGEST_STORAGE_KEY)
}

function readSuggestAuth(): GuestAuth | null {
  const raw = window.localStorage.getItem(SUGGEST_AUTH_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GuestAuth>
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken !== '' &&
      typeof parsed.nickname === 'string' &&
      parsed.nickname !== '' &&
      typeof parsed.user?.id === 'string'
    ) {
      return {
        accessToken: parsed.accessToken,
        nickname: parsed.nickname,
        user: parsed.user as UserProfile,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(SUGGEST_AUTH_STORAGE_KEY)
  return null
}

function saveSuggestAuth(auth: GuestAuth) {
  window.localStorage.setItem(SUGGEST_AUTH_STORAGE_KEY, JSON.stringify(auth))
}

function clearSuggestAuth() {
  window.localStorage.removeItem(SUGGEST_AUTH_STORAGE_KEY)
}

function normalizeTagList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ''),
    ),
  )
}

function readSuggestDraft(): SuggestDraft | null {
  const raw = window.localStorage.getItem(SUGGEST_DRAFT_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SuggestDraft> &
      Partial<{
        sourceUrl: string
        youtubeId: string
        thumbnailUrl: string
        thumbnailDataUrl: string
        isOffVocal: boolean
        hasLyrics: boolean
        genres: string[]
      }>

    if (
      typeof parsed.source_url === 'string' &&
      typeof parsed.source_id === 'string' &&
      typeof parsed.source === 'string' &&
      typeof parsed.source_thumbnail === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.artist === 'string' &&
      typeof parsed.language === 'string' &&
      typeof parsed.is_off_vocal === 'boolean' &&
      typeof parsed.video_has_lyrics === 'boolean' &&
      typeof parsed.genre === 'string' &&
      Array.isArray(parsed.tags) &&
      parsed.tags.every((item) => typeof item === 'string') &&
      typeof parsed.lyrics === 'string' &&
      typeof parsed.source_thumbnail_data_url === 'string'
    ) {
      return {
        source_url: parsed.source_url,
        source_id: parsed.source_id,
        source: parsed.source,
        source_thumbnail: parsed.source_thumbnail,
        title: parsed.title,
        artist: parsed.artist,
        language: parsed.language,
        is_off_vocal: parsed.is_off_vocal,
        video_has_lyrics: parsed.video_has_lyrics,
        genre: parsed.genre.trim(),
        tags: normalizeTagList(parsed.tags),
        lyrics: parsed.lyrics,
        source_thumbnail_data_url: parsed.source_thumbnail_data_url,
      }
    }

    if (
      typeof parsed.title === 'string' &&
      typeof parsed.artist === 'string' &&
      typeof parsed.sourceUrl === 'string' &&
      typeof parsed.youtubeId === 'string' &&
      typeof parsed.thumbnailUrl === 'string' &&
      typeof parsed.thumbnailDataUrl === 'string' &&
      typeof parsed.language === 'string' &&
      typeof parsed.isOffVocal === 'boolean' &&
      typeof parsed.hasLyrics === 'boolean' &&
      Array.isArray(parsed.genres) &&
      parsed.genres.every((item) => typeof item === 'string') &&
      Array.isArray(parsed.tags) &&
      parsed.tags.every((item) => typeof item === 'string') &&
      typeof parsed.lyrics === 'string'
    ) {
      return {
        source_url: parsed.sourceUrl,
        source_id: parsed.youtubeId,
        source: 'youtube',
        source_thumbnail: parsed.thumbnailUrl,
        title: parsed.title,
        artist: parsed.artist,
        language: parsed.language,
        is_off_vocal: parsed.isOffVocal,
        video_has_lyrics: parsed.hasLyrics,
        genre: parsed.genres[0] ?? '',
        tags: normalizeTagList(parsed.tags),
        lyrics: parsed.lyrics,
        source_thumbnail_data_url: parsed.thumbnailDataUrl,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(SUGGEST_DRAFT_STORAGE_KEY)
  return null
}

function saveSuggestDraft(draft: SuggestDraft) {
  window.localStorage.setItem(
    SUGGEST_DRAFT_STORAGE_KEY,
    JSON.stringify({
      ...draft,
      genre: draft.genre.trim(),
      tags: normalizeTagList(draft.tags),
    }),
  )
}

function clearSuggestDraft() {
  window.localStorage.removeItem(SUGGEST_DRAFT_STORAGE_KEY)
}

function buildInitialSuggestDraft(payload: SuggestIdentifyResponse): SuggestDraft {
  return {
    source_url: payload.source_url,
    source_id: payload.source_id,
    source: payload.source,
    source_thumbnail: payload.source_thumbnail,
    title: payload.title,
    artist: payload.artist,
    language: payload.language ?? '',
    is_off_vocal: payload.is_off_vocal,
    video_has_lyrics: payload.video_has_lyrics,
    genre: payload.genre ?? '',
    tags: normalizeTagList(payload.tags ?? []),
    lyrics: payload.lyrics ?? '',
    source_thumbnail_data_url: '',
  }
}

function normalizeSuggestQuery(query: string): { effectiveQuery: string; appendedKaraoke: boolean } {
  const trimmed = query.trim()
  if (trimmed === '') {
    return { effectiveQuery: '', appendedKaraoke: false }
  }

  if (SUGGEST_KEYWORD_REGEX.test(trimmed)) {
    return { effectiveQuery: trimmed, appendedKaraoke: false }
  }

  return { effectiveQuery: `${trimmed} karaoke`, appendedKaraoke: true }
}

function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (!YOUTUBE_URL_REGEX.test(trimmed)) {
    return null
  }

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
      return id !== '' ? id : null
    }

    const id = url.searchParams.get('v') ?? ''
    return id !== '' ? id : null
  } catch {
    return null
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
        return
      }
      reject(new Error('Unable to read image file'))
    }
    reader.onerror = () => {
      reject(new Error('Unable to read image file'))
    }
    reader.readAsDataURL(file)
  })
}

function splitChipInput(value: string, transform?: (entry: string) => string): string[] {
  const normalizeEntry = transform ?? ((entry: string) => entry.trim())
  return value
    .split(',')
    .map((entry) => normalizeEntry(entry))
    .filter((entry) => entry !== '')
}

function createMockSuggestResults(query: string): SuggestResult[] {
  const base = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12) || 'song'

  return Array.from({ length: 3 }, (_, index) => {
    const suffix = `${base}${index + 1}`.slice(0, 11)
    return {
      id: `mock-${suffix}`,
      title: `${query} (Karaoke Mix ${index + 1})`,
      channelName: `Mock Channel ${index + 1}`,
      channelUrl: 'https://www.youtube.com',
      thumbnailUrl: 'https://via.placeholder.com/320x180?text=No+Thumbnail',
      duration: '0:00',
      description: 'Mock search result.',
      viewCount: null,
      uploadedAt: '',
      existsInSongbook: null,
      sourceUrl: `https://www.youtube.com/watch?v=${suffix}`,
      youtubeId: suffix,
    }
  })
}

async function guestLoginWithNickname(nickname: string): Promise<GuestAuth> {
  const payload = await apiJson<GuestLoginResponse>('/users/guest/login', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  })

  return {
    accessToken: payload.access_token,
    nickname: payload.nickname,
    user: payload.user,
  }
}

async function suggestSearch(query: string, token: string): Promise<SuggestSearchResponse> {
  return apiJson<SuggestSearchResponse>(
    `/songs/suggest/search?keyword=${encodeURIComponent(query)}&limit=20`,
    {
      method: 'POST',
      body: JSON.stringify({ query, limit: 20 }),
    },
    token,
  )
}

async function suggestIdentify(url: string, token: string, enhance: boolean = false): Promise<SuggestIdentifyResponse> {
  const queryParams = new URLSearchParams()
  if (enhance) {
    queryParams.append('enhance', 'true')
  }
  const queryString = queryParams.toString()
  const endpoint = `/songs/suggest/identify${queryString ? `?${queryString}` : ''}`
  return apiJson<SuggestIdentifyResponse>(
    endpoint,
    {
      method: 'POST',
      body: JSON.stringify({ url }),
    },
    token,
  )
}

async function suggestDownload(draft: SuggestDraft, token: string): Promise<{ status: string; message: string; song_id: string }> {
  const normalizedGenre = draft.genre.trim()
  const normalizedSource = draft.source.trim()
  const normalizedGenres = normalizedGenre === '' ? [] : [normalizedGenre]
  return apiJson<{ status: string; message: string; song_id: string }>(
    '/songs/suggest/download',
    {
      method: 'POST',
      body: JSON.stringify({
        source_url: draft.source_url,
        source_id: draft.source_id,
        source: normalizedSource === '' ? 'youtube' : normalizedSource,
        source_thumbnail: draft.source_thumbnail,
        source_thumbnail_data_url: draft.source_thumbnail_data_url,
        title: draft.title,
        artist: draft.artist,
        language: draft.language || null,
        is_off_vocal: draft.is_off_vocal,
        video_has_lyrics: draft.video_has_lyrics,
        genre: normalizedGenres,
        tags: normalizeTagList(draft.tags),
        lyrics: draft.lyrics,
      }),
    },
    token,
  )
}

async function suggestEnhance(draft: SuggestDraft, token: string): Promise<SuggestEnhanceResponse> {
  const normalizedGenre = draft.genre.trim()
  const normalizedSource = draft.source.trim()
  const normalizedGenres = normalizedGenre === '' ? [] : [normalizedGenre]
  return apiJson<SuggestEnhanceResponse>(
    '/songs/suggest/enhance',
    {
      method: 'POST',
      body: JSON.stringify({
        source_url: draft.source_url,
        source_id: draft.source_id,
        source: normalizedSource === '' ? 'youtube' : normalizedSource,
        source_thumbnail: draft.source_thumbnail,
        title: draft.title,
        artist: draft.artist,
        language: draft.language,
        is_off_vocal: draft.is_off_vocal,
        video_has_lyrics: draft.video_has_lyrics,
        genre: normalizedGenres,
        tags: normalizeTagList(draft.tags),
        lyrics: draft.lyrics,
      }),
    },
    token,
  )
}

async function suggestMetadataSuggestions(
  keyword: string,
  token: string,
): Promise<SuggestMetadataSuggestionsResponse> {
  const params = new URLSearchParams({ limit: '10' })
  const normalizedKeyword = keyword.trim()
  if (normalizedKeyword !== '') {
    params.set('keyword', normalizedKeyword)
  }
  return apiJson<SuggestMetadataSuggestionsResponse>(`/songs/suggest/suggestions?${params.toString()}`, {}, token)
}

async function fetchSongbook(page: number = 1, limit: number = 20): Promise<SongbookListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const raw = await apiJson<{
    items: Array<{
      id: string; title: string; artist: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
    }>
    total: number; page: number; pages: number
  }>(`/songs?${params.toString()}`)
  return {
    ...raw,
    items: raw.items.map((s) => ({
      id: s.id, title: s.title, artist: s.artist, duration: s.duration,
      language: s.language, genre: s.genre, tags: s.tags,
      thumbnailUrl: s.thumbnail_url, sourceId: s.source_id, sourceUrl: s.source_url,
      videoFile: s.video_file,
      lyrics: s.lyrics,
      addedByUsername: s.added_by_username,
    })),
  }
}

async function searchSongbook(q: string, page: number = 1, limit: number = 20): Promise<SongbookListResponse> {
  const params = new URLSearchParams({ q, page: String(page), limit: String(limit) })
  const raw = await apiJson<{
    items: Array<{
      id: string; title: string; artist: string; duration: string
      language: string | null; genre: string | null; tags: string[]
      thumbnail_url: string | null; source_id: string | null; source_url: string | null
      video_file: string | null; lyrics: string | null; added_by_username: string | null
    }>
    total: number; page: number; pages: number
  }>(`/songs/search?${params.toString()}`)
  return {
    ...raw,
    items: raw.items.map((s) => ({
      id: s.id, title: s.title, artist: s.artist, duration: s.duration,
      language: s.language, genre: s.genre, tags: s.tags,
      thumbnailUrl: s.thumbnail_url, sourceId: s.source_id, sourceUrl: s.source_url,
      videoFile: s.video_file,
      lyrics: s.lyrics,
      addedByUsername: s.added_by_username,
    })),
  }
}

async function fetchSongDetail(id: string): Promise<SongbookSong> {
  const raw = await apiJson<{
    id: string; title: string; artist: string; duration: string
    language: string | null; genre: string | null; tags: string[]
    thumbnail_url: string | null; source_id: string | null; source_url: string | null
    video_file: string | null; lyrics: string | null; added_by_username: string | null
  }>(`/songs/${id}`)
  return {
    id: raw.id, title: raw.title, artist: raw.artist, duration: raw.duration,
    language: raw.language, genre: raw.genre, tags: raw.tags,
    thumbnailUrl: raw.thumbnail_url, sourceId: raw.source_id, sourceUrl: raw.source_url,
    videoFile: raw.video_file,
    lyrics: raw.lyrics,
    addedByUsername: raw.added_by_username,
  }
}

function authHeaders(token?: string): HeadersInit {
  if (token === undefined) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

function buildWSUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  if (query === '') {
    return `${WS_BASE}${path}`
  }
  return `${WS_BASE}${path}?${query}`
}

function normalizeDownloadProgressItems(payload: unknown): DownloadProgressItem[] {
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
      raw.status === 'pending' || raw.status === 'downloading' || raw.status === 'error'
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

async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  if (token !== undefined) {
    const bearerHeaders = authHeaders(token)
    Object.entries(bearerHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })
  }

  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null
    throw new ApiError(payload?.detail ?? 'Request failed', response.status)
  }

  return response.json() as Promise<T>
}

function LoadingView() {
  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Admin</h1>
        <p className="subtitle">Restoring session...</p>
      </section>
    </main>
  )
}

function GuestPage() {
  const navigate = useNavigate()

  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Guest</h1>
        <p className="subtitle">
          Welcome! Browse the songbook first, then suggest songs that are not yet listed.
        </p>
        <div className="row-actions top-gap">
          <button type="button" onClick={() => navigate('/songbook')}>
            Open Songbook
          </button>
          <button type="button" className="secondary" onClick={() => navigate('/admin/login')}>
            Admin Login
          </button>
        </div>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Skeleton loader — shared between Songbook and YouTube search
// ---------------------------------------------------------------------------

function SkeletonSongItem() {
  return (
    <div className="skeleton-item">
      <div className="skeleton skeleton-thumb" />
      <div className="skeleton-info">
        <div className="skeleton skeleton-line skeleton-line--title" />
        <div className="skeleton skeleton-line skeleton-line--meta" />
      </div>
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonSongItem key={i} />
      ))}
    </>
  )
}

function BlockingHud({ message }: { message: string }) {
  return (
    <div className="blocking-hud" role="status" aria-live="polite" aria-busy="true">
      <div className="blocking-hud-card">
        <div className="blocking-hud-spinner" />
        <p>{message}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Song Detail Page
// ---------------------------------------------------------------------------

function SongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [song, setSong] = useState<SongbookSong | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

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

  const handleVideoLoaded = () => {
    const el = videoRef.current
    if (!el || !el.duration) return
    el.currentTime = el.duration * 0.25
  }

  return (
    <main
      className="modal-backdrop song-detail-backdrop"
      role="presentation"
      onClick={() => navigate('/songbook')}
    >
      <section
        className="modal-card song-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={song?.title ?? 'Song details'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Song Details</h2>
            {song !== null ? <p className="subtitle">{song.artist}</p> : null}
          </div>
          <button type="button" className="secondary" onClick={() => navigate('/songbook')}>
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="top-gap">
            <SkeletonList count={1} />
          </div>
        ) : error !== '' ? (
          <p className="error-message top-gap">{error}</p>
        ) : song !== null ? (
          <div className="song-detail-layout">
            <div className="song-detail-video-panel">
              {song.videoFile ? (
                <video
                  ref={videoRef}
                  controls
                  className="song-detail-video"
                  onLoadedMetadata={handleVideoLoaded}
                  src={`/media/songs/${song.videoFile}`}
                />
              ) : (
                <p className="empty-state">Video not available.</p>
              )}
            </div>

            <div className="song-detail-panels">
              <div className="song-detail-summary-panel">
                <div className="song-detail-header-row">
                  {song.thumbnailUrl ? (
                    <img
                      className="song-detail-thumbnail song-detail-thumbnail--small"
                      src={song.thumbnailUrl}
                      alt={song.title}
                    />
                  ) : (
                    <div className="song-detail-thumbnail song-detail-thumbnail--small song-detail-thumbnail--placeholder" />
                  )}
                  <div className="song-detail-meta">
                    <h1 className="song-detail-title">{song.title}</h1>
                    <p className="subtitle">{song.artist}</p>
                  </div>
                </div>

                <dl className="song-detail-grid top-gap">
                  <div>
                    <dt>Language</dt>
                    <dd>{song.language ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Genre</dt>
                    <dd>{song.genre ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{song.duration}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{song.sourceUrl ? 'YouTube' : '—'}</dd>
                  </div>
                  <div>
                    <dt>Added by</dt>
                    <dd>{song.addedByUsername ?? '—'}</dd>
                  </div>
                  {song.sourceId ? (
                    <div className="song-detail-grid-wide">
                      <dt>Source ID</dt>
                      <dd>{song.sourceId}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="song-detail-chips top-gap">
                  {song.language ? <span className="chip-badge">{song.language.toUpperCase()}</span> : null}
                  {song.genre ? <span className="chip-badge">{song.genre}</span> : null}
                  {song.duration ? <span className="chip-badge">{song.duration}</span> : null}
                  {song.tags.map((t) => (
                    <span key={t} className="chip-badge chip-badge--tag">{t}</span>
                  ))}
                </div>

                {song.sourceUrl ? (
                  <div className="top-gap">
                    <a
                      href={song.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="secondary-link"
                    >
                      View on YouTube ↗
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="song-detail-lyrics-panel">
                <h3>Lyrics</h3>
                <p className="song-detail-lyrics">
                  {song.lyrics !== null && song.lyrics.trim() !== '' ? song.lyrics : 'No lyrics available.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

type SongContextMenu = { song: SongbookSong; x: number; y: number } | null

type SongbookPageProps = {
  notice: string
  guestNickname: string | null
  onChangeNickname: () => void
}

function SongbookPage({ notice, guestNickname, onChangeNickname }: SongbookPageProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [songs, setSongs] = useState<SongbookSong[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [contextMenu, setContextMenu] = useState<SongContextMenu>(null)
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [downloadItems, setDownloadItems] = useState<DownloadProgressItem[]>([])
  const [downloadsSocketStatus, setDownloadsSocketStatus] = useState('Disconnected')
  const [retryingSongIds, setRetryingSongIds] = useState<string[]>([])
  const downloadsSocketRef = useRef<WebSocket | null>(null)
  const downloadsReconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectDownloadsRef = useRef(false)
  const downloadReconnectAttemptsRef = useRef(0)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(timer)
  }, [query])

  // Fetch when debounced query or page changes
  useEffect(() => {
    setIsLoading(true)
    const trimmed = debouncedQuery.trim()
    const fetchFn = trimmed === '' ? fetchSongbook(page) : searchSongbook(trimmed, page)
    fetchFn
      .then((data) => {
        setSongs(data.items)
        setPages(data.pages)
      })
      .catch(() => setSongs([]))
      .finally(() => setIsLoading(false))
  }, [debouncedQuery, page])

  // Reset to page 1 on new query
  useEffect(() => {
    setPage(1)
  }, [debouncedQuery])

  // Close context menu on outside click
  useEffect(() => {
    if (contextMenu === null) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  const clearDownloadsReconnectTimer = useCallback(() => {
    if (downloadsReconnectTimerRef.current !== null) {
      window.clearTimeout(downloadsReconnectTimerRef.current)
      downloadsReconnectTimerRef.current = null
    }
  }, [])

  const closeDownloadsSocket = useCallback(() => {
    const socket = downloadsSocketRef.current
    downloadsSocketRef.current = null
    if (socket !== null) {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (!isDownloadsModalOpen) {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
      setDownloadsSocketStatus('Disconnected')
      return
    }

    shouldReconnectDownloadsRef.current = true
    downloadReconnectAttemptsRef.current = 0

    const scheduleReconnect = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }
      clearDownloadsReconnectTimer()
      const delaySeconds = Math.min(2 ** downloadReconnectAttemptsRef.current, 8)
      downloadReconnectAttemptsRef.current += 1
      setDownloadsSocketStatus(`Reconnecting in ${delaySeconds}s...`)
      downloadsReconnectTimerRef.current = window.setTimeout(() => {
        downloadsReconnectTimerRef.current = null
        connectSocket()
      }, delaySeconds * 1000)
    }

    const connectSocket = () => {
      if (!shouldReconnectDownloadsRef.current) {
        return
      }

      setDownloadsSocketStatus('Connecting...')
      const socket = new WebSocket(buildWSUrl('/ws/guest', {}))
      downloadsSocketRef.current = socket

      socket.onopen = () => {
        downloadReconnectAttemptsRef.current = 0
        setDownloadsSocketStatus('Connected')
      }

      socket.onclose = () => {
        if (!shouldReconnectDownloadsRef.current) {
          setDownloadsSocketStatus('Disconnected')
          return
        }
        scheduleReconnect()
      }

      socket.onerror = () => {
        setDownloadsSocketStatus('Connection error')
      }

      socket.onmessage = (event) => {
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }
        if (payload.type !== 'downloads.updated') {
          return
        }
        setDownloadItems(normalizeDownloadProgressItems(payload.payload.items))
      }
    }

    connectSocket()
    return () => {
      shouldReconnectDownloadsRef.current = false
      clearDownloadsReconnectTimer()
      closeDownloadsSocket()
    }
  }, [isDownloadsModalOpen, clearDownloadsReconnectTimer, closeDownloadsSocket])

  const handleSongClick = (event: React.MouseEvent, song: SongbookSong) => {
    event.stopPropagation()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({ song, x: rect.left, y: rect.bottom + window.scrollY })
  }

  const handleRetryDownload = useCallback((songId: string) => {
    setRetryingSongIds((current) => (current.includes(songId) ? current : [...current, songId]))
    void apiJson<SongDownloadRetryResponse>(`/songs/downloads/${songId}/retry`, {
      method: 'POST',
    })
      .then(() => {
        setDownloadItems((items) =>
          items.map((item) =>
            item.songId === songId
              ? {
                  ...item,
                  status: 'pending',
                  progressPct: null,
                  progressMessage: 'Waiting in queue',
                  errorMessage: null,
                }
              : item,
          ),
        )
      })
      .finally(() => {
        setRetryingSongIds((current) => current.filter((entry) => entry !== songId))
      })
  }, [])

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            {guestNickname !== null ? (
              <p className="subtitle">
                Signed in as <strong>{guestNickname}</strong>
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setIsDownloadsModalOpen(true)}
            >
              Download Progress
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  guestNickname !== null
                    ? '/songbook/suggest/search'
                    : '/songbook/suggest/login',
                )
              }
            >
              Suggest a Song
            </button>
          </div>
        </div>

        {notice !== '' ? <p className="success-message top-gap">{notice}</p> : null}

        <div className="form top-gap">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, artist, genre, tags, etc."
          />
        </div>

        <div className="queue-list top-gap">
          {isLoading ? (
            <SkeletonList count={8} />
          ) : songs.length === 0 ? (
            <p className="empty-state">No songs found. Try suggesting a new one.</p>
          ) : (
            songs.map((song) => (
              <article
                className="queue-item songbook-item"
                key={song.id}
                onClick={(e) => handleSongClick(e, song)}
                style={{ cursor: 'pointer' }}
              >
                {song.thumbnailUrl ? (
                  <img
                    className="songbook-thumbnail"
                    src={song.thumbnailUrl}
                    alt={song.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
                )}
                <div className="songbook-info">
                  <strong>{song.title}</strong>
                  <p className="session-meta">
                    {song.artist}
                    {song.duration ? ` · ${song.duration}` : ''}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>

        {pages > 1 ? (
          <div className="pagination top-gap">
            <button
              type="button"
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span className="pagination-info">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        ) : null}
      </section>

      {guestNickname !== null ? (
        <div className="change-nickname-outside">
          <button type="button" className="secondary small" onClick={onChangeNickname}>
            Change Nickname
          </button>
        </div>
      ) : null}

      {contextMenu !== null ? (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              navigate(`/songbook/song/${contextMenu.song.id}`)
              setContextMenu(null)
            }}
          >
            Details
          </button>
          {contextMenu.song.sourceUrl ? (
            <button
              type="button"
              onClick={() => {
                window.open(contextMenu.song.sourceUrl!, '_blank', 'noopener,noreferrer')
                setContextMenu(null)
              }}
            >
              View on YouTube
            </button>
          ) : null}
        </div>
      ) : null}

      {isDownloadsModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsDownloadsModalOpen(false)}
          role="presentation"
        >
          <section
            className="modal-card downloads-modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Download Progress</h2>
                <p className="subtitle">Status: {downloadsSocketStatus}</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setIsDownloadsModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="downloads-modal-list top-gap">
              {downloadItems.length === 0 ? (
                <p className="empty-state">No active downloads.</p>
              ) : (
                downloadItems.map((item) => {
                  const isRetrying = retryingSongIds.includes(item.songId)
                  const progressValue =
                    item.progressPct !== null ? Math.max(0, Math.min(100, item.progressPct)) : 0
                  const statusText =
                    item.status === 'error'
                      ? item.errorMessage ?? 'Download failed'
                      : item.progressMessage ??
                        (item.status === 'pending' ? 'Waiting in queue' : 'Downloading')

                  return (
                    <article key={item.songId} className="downloads-progress-item">
                      {item.sourceThumbnail ? (
                        <img
                          className="downloads-progress-thumb"
                          src={item.sourceThumbnail}
                          alt={item.title}
                          loading="lazy"
                        />
                      ) : (
                        <div className="downloads-progress-thumb downloads-progress-thumb--placeholder" />
                      )}
                      <div className="downloads-progress-content">
                        <strong>{item.title}</strong>
                        <p className="session-meta">
                          {(item.duration ?? '--:--') +
                            ' * ' +
                            item.artist +
                            ' * ' +
                            (item.addedByUsername ?? '—')}
                        </p>
                        <div className="downloads-progress-row">
                          <progress
                            className="downloads-progress-bar"
                            max={100}
                            value={progressValue}
                          />
                          <span className={`badge download-status-badge ${item.status}`}>
                            {item.status}
                          </span>
                        </div>
                        <p className="session-meta">{statusText}</p>
                        {item.status === 'error' ? (
                          <div className="downloads-actions">
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => handleRetryDownload(item.songId)}
                              disabled={isRetrying}
                            >
                              {isRetrying ? 'Retrying…' : 'Retry'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

type SuggestLoginPageProps = {
  initialNickname: string
  onLogin: (nickname: string) => Promise<void>
}

function SuggestLoginPage({ initialNickname, onLogin }: SuggestLoginPageProps) {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(initialNickname)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Suggest Song Login</h1>
        <p className="subtitle">Nickname must use letters, numbers, and underscore only.</p>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isValidSuggestNickname(nickname)) {
              setErrorMessage('Use only letters, numbers, or underscores.')
              return
            }
            setErrorMessage('')
            setIsSubmitting(true)
            void onLogin(nickname)
              .then(() => navigate('/songbook/suggest/search'))
              .catch((error: unknown) => {
                const message =
                  error instanceof Error ? error.message : 'Guest login failed'
                setErrorMessage(message)
              })
              .finally(() => {
                setIsSubmitting(false)
              })
          }}
        >
          <label>
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="guest_user"
              required
            />
          </label>
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  )
}

type SuggestSearchPageProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
  onIdentify: (sourceUrl: string) => void
}

function SuggestSearchPage({
  nickname,
  authToken,
  onCancel,
  onChangeNickname,
  onIdentify,
}: SuggestSearchPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const lastSearchedKeywordRef = useRef('')
  const [query, setQuery] = useState('')
  const [effectiveQuery, setEffectiveQuery] = useState('')
  const [queryInfo, setQueryInfo] = useState('')
  const [results, setResults] = useState<SuggestResult[]>([])
  const [selectedResult, setSelectedResult] = useState<SuggestResult | null>(null)
  const [menuResult, setMenuResult] = useState<SuggestResult | null>(null)
  const [pendingIdentifyResult, setPendingIdentifyResult] = useState<SuggestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  const requestIdentify = useCallback(
    (result: SuggestResult) => {
      if (result.existsInSongbook === true) {
        setPendingIdentifyResult(result)
        return
      }

      onIdentify(result.sourceUrl)
    },
    [onIdentify],
  )

  const executeSearch = useCallback(
    (searchQuery: string) => {
      const normalized = normalizeSuggestQuery(searchQuery)
      if (normalized.effectiveQuery === '') {
        setQueryInfo('Please enter a search query.')
        setResults([])
        setEffectiveQuery('')
        lastSearchedKeywordRef.current = ''
        return
      }

      setErrorMessage('')
      setIsSearching(true)
      lastSearchedKeywordRef.current = searchQuery.trim()

      void suggestSearch(normalized.effectiveQuery, authToken)
        .then((response) => {
          setEffectiveQuery(response.effective_query)
          setQueryInfo(
            response.appended_karaoke ? 'Backend appended "karaoke" to the query.' : '',
          )
          setResults(
            response.results.map((item) => ({
              id: item.id,
              title: item.title,
              channelName: item.channel_name,
              channelUrl: item.channel_url,
              thumbnailUrl: item.thumbnail_url,
              duration: item.duration,
              description: item.description,
              viewCount: item.view_count,
              uploadedAt: item.uploaded_at,
              existsInSongbook: item.exists_in_songbook,
              sourceUrl: item.source_url,
              youtubeId: item.youtube_id,
            })),
          )
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Search failed'
          setErrorMessage(message)
          setEffectiveQuery(normalized.effectiveQuery)
          setQueryInfo('Falling back to mock search results.')
          setResults(createMockSuggestResults(normalized.effectiveQuery))
        })
        .finally(() => {
          setIsSearching(false)
        })
    },
    [authToken],
  )

  useEffect(() => {
    const keyword = new URLSearchParams(location.search).get('keyword') ?? ''
    if (keyword !== '' && keyword.trim() !== lastSearchedKeywordRef.current) {
      setQuery(keyword)
      executeSearch(keyword)
    }
  }, [executeSearch, location.search])

  return (
    <main className="app-shell">
      <section className="card">
        <h1>Suggest · Search YouTube</h1>
        <p className="subtitle">Signed in as <strong>{nickname}</strong></p>
        <div className="row-actions top-gap">
          <button type="button" className="secondary" onClick={onChangeNickname}>
            Change Nickname
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (query.trim() !== '' || results.length > 0) {
                const shouldLeave = window.confirm(
                  'Cancel this suggestion and go back to songbook?',
                )
                if (!shouldLeave) {
                  return
                }
              }
              onCancel()
              navigate('/songbook')
            }}
          >
            Back to Songbook
          </button>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            const normalized = normalizeSuggestQuery(query)
            if (normalized.effectiveQuery === '') {
              setQueryInfo('Please enter a search query.')
              setResults([])
              setEffectiveQuery('')
              return
            }
            navigate({
              pathname: '/songbook/suggest/search',
              search: `?keyword=${encodeURIComponent(query.trim())}`,
            })
            executeSearch(query)
          }}
        >
          <label>
            Search query
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="song title"
              required
            />
          </label>
          <div className="row-actions">
            <button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching…' : 'Search'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => navigate('/songbook/suggest/identify')}
            >
              Paste URL Instead
            </button>
          </div>
        </form>
        {errorMessage !== '' ? <p className="error-message top-gap">{errorMessage}</p> : null}
        {queryInfo !== '' ? <p className="subtitle top-gap">{queryInfo}</p> : null}
        {effectiveQuery !== '' ? (
          <p className="subtitle">
            Effective query: <code>{effectiveQuery}</code>
          </p>
        ) : null}
        <div className="queue-list top-gap">
          {isSearching ? (
            <SkeletonList count={5} />
          ) : results.length === 0 ? (
            null
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="search-result-row"
                onClick={() => setMenuResult(result)}
              >
                <img className="search-result-thumb" src={result.thumbnailUrl} alt={result.title} />
                <div className="search-result-content">
                  <strong className="search-result-title" title={result.title}>
                    {result.title}
                  </strong>
                  <p className="search-result-meta">
                    {result.duration} - {result.channelName}
                  </p>
                  {result.existsInSongbook === true ? (
                    <p className="search-result-exists">✔ Already in songbook</p>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
        {menuResult !== null ? (
          <div className="modal-backdrop" role="presentation" onClick={() => setMenuResult(null)}>
            <div
              className="context-menu-card"
              role="dialog"
              aria-modal="true"
              aria-label={`${menuResult.title} actions`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="context-menu-header">
                <strong title={menuResult.title}>{menuResult.title}</strong>
                <button type="button" className="secondary" onClick={() => setMenuResult(null)}>
                  Close
                </button>
              </div>
              <div className="search-result-menu">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    requestIdentify(menuResult)
                    setMenuResult(null)
                  }}
                >
                  Identify
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSelectedResult(menuResult)
                    setMenuResult(null)
                  }}
                >
                  Details
                </button>
                <button
                  type="button"
                  className="secondary youtube-button"
                  onClick={() => window.open(menuResult.sourceUrl, '_blank', 'noopener,noreferrer')}
                >
                  View on Youtube
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {selectedResult !== null ? (
          <SearchResultModal
            result={selectedResult}
            onClose={() => setSelectedResult(null)}
            onIdentify={requestIdentify}
          />
        ) : null}
        {pendingIdentifyResult !== null ? (
          <IdentifyOverrideModal
            result={pendingIdentifyResult}
            onCancel={() => setPendingIdentifyResult(null)}
            onConfirm={() => {
              onIdentify(pendingIdentifyResult.sourceUrl)
              setPendingIdentifyResult(null)
            }}
          />
        ) : null}
      </section>
    </main>
  )
}

type SearchResultModalProps = {
  result: SuggestResult
  onClose: () => void
  onIdentify: (result: SuggestResult) => void
}

function SearchResultModal({ result, onClose, onIdentify }: SearchResultModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${result.title} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{result.title}</h2>
            <p className="subtitle">
              {result.duration} · {result.channelName}
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-player">
            {result.youtubeId !== '' ? (
              <iframe
                title={result.title}
                src={`https://www.youtube.com/embed/${result.youtubeId}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <p className="empty-state">Embedded player unavailable for this result.</p>
            )}
          </div>

          <div className="modal-details">
            <p className="session-meta">
              <strong>Channel:</strong> {result.channelName}
            </p>
            <p className="session-meta">
              <strong>Source:</strong>{' '}
              <a href={result.sourceUrl} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
            </p>
            {result.channelUrl !== '' ? (
              <p className="session-meta">
                <strong>Channel URL:</strong>{' '}
                <a href={result.channelUrl} target="_blank" rel="noreferrer">
                  Open channel
                </a>
              </p>
            ) : null}
            {result.uploadedAt !== '' ? (
              <p className="session-meta">
                <strong>Uploaded:</strong> {result.uploadedAt}
              </p>
            ) : null}
            {result.viewCount !== null ? (
              <p className="session-meta">
                <strong>Views:</strong> {result.viewCount.toLocaleString()}
              </p>
            ) : null}
            <p className="session-meta">
              <strong>Songbook status:</strong>{' '}
              {result.existsInSongbook === true
                ? 'Already in songbook'
                : result.existsInSongbook === false
                  ? 'Not in songbook yet'
                  : 'Pending'}
            </p>
            {result.description !== '' ? (
              <p className="modal-description">{result.description}</p>
            ) : null}
          </div>
        </div>

        <div className="row-actions modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onIdentify(result)}
          >
            Identify
          </button>
          <button
            type="button"
            className="youtube-button"
            onClick={() => window.open(result.sourceUrl, '_blank', 'noopener,noreferrer')}
          >
            View on Youtube
          </button>
        </div>
      </div>
    </div>
  )
}

type IdentifyOverrideModalProps = {
  result: SuggestResult
  onCancel: () => void
  onConfirm: () => void
}

function IdentifyOverrideModal({ result, onCancel, onConfirm }: IdentifyOverrideModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card context-menu-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${result.title} already exists`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Song already exists</h2>
            <p className="subtitle">{result.title}</p>
          </div>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <p className="modal-description top-gap">
          This video already exists or is currently downloading. Do you want to override it and identify again?
        </p>

        <div className="row-actions modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Identify
          </button>
        </div>
      </div>
    </div>
  )
}

type SuggestIdentifyPageProps = {
  nickname: string
  authToken: string
  onIdentify: (draft: SuggestDraft) => void
  onCancel: () => void
  onChangeNickname: () => void
}

function SuggestIdentifyPage({
  nickname,
  authToken,
  onIdentify,
  onCancel,
  onChangeNickname,
}: SuggestIdentifyPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const autoIdentifiedUrlRef = useRef('')
  const [url, setUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const runIdentify = useCallback(
    (nextUrl: string) => {
      const normalizedUrl = nextUrl.trim()
      const videoId = parseYouTubeVideoId(normalizedUrl)
      if (videoId === null) {
        setErrorMessage('Enter a valid YouTube URL.')
        return
      }

      setErrorMessage('')
      setIsSubmitting(true)
      autoIdentifiedUrlRef.current = normalizedUrl

      void suggestIdentify(normalizedUrl, authToken, true)
        .then((response) => {
          setIsSubmitting(false)
          onIdentify(buildInitialSuggestDraft(response))
          navigate('/songbook/suggest/update', { replace: true })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Identify failed'
          setErrorMessage(message)
          setIsSubmitting(false)
        })
    },
    [authToken, navigate, onIdentify],
  )

  useEffect(() => {
    const queryUrl = new URLSearchParams(location.search).get('url') ?? ''
    if (queryUrl === '') {
      return
    }

    setUrl(queryUrl)
    if (queryUrl.trim() === autoIdentifiedUrlRef.current) {
      return
    }

    runIdentify(queryUrl)
  }, [location.search, runIdentify])

  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Suggest · Identify URL</h1>
        <p className="subtitle">Signed in as <strong>{nickname}</strong></p>
        <div className="row-actions top-gap">
          <button type="button" className="secondary" onClick={onChangeNickname}>
            Change Nickname
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (url.trim() !== '') {
                const shouldLeave = window.confirm(
                  'Cancel this suggestion and go back to songbook?',
                )
                if (!shouldLeave) {
                  return
                }
              }
              onCancel()
              navigate('/songbook')
            }}
          >
            Back to Songbook
          </button>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            runIdentify(url)
          }}
        >
          <label>
            YouTube URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              required
            />
          </label>
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
          <div className="row-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Identifying…' : 'Identify'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => navigate('/songbook/suggest/search')}
            >
              Back to Search
            </button>
          </div>
        </form>
        {isSubmitting ? <BlockingHud message="Identifying song details..." /> : null}
      </section>
    </main>
  )
}

type SuggestUpdatePageProps = {
  nickname: string
  authToken: string
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft) => void
  onDownload: (title: string) => void
  onCancel: () => void
  onChangeNickname: () => void
}

type ChipFieldProps = {
  label: string
  values: string[]
  inputValue: string
  placeholder: string
  helperText?: string
  required?: boolean
  suggestions?: string[]
  datalistId?: string
  onInputValueChange: (value: string) => void
  onCommitValue: () => void
  onSelectSuggestion?: (value: string) => void
  onRemoveValue: (value: string) => void
}

function ChipField({
  label,
  values,
  inputValue,
  placeholder,
  helperText,
  required,
  suggestions,
  datalistId,
  onInputValueChange,
  onCommitValue,
  onSelectSuggestion,
  onRemoveValue,
}: ChipFieldProps) {
  return (
    <label>
      {label}
      <div className="chip-input-shell">
        <div className="chip-list">
          {values.length === 0 ? (
            <span className="chip-empty">{required ? 'At least one required' : 'None yet'}</span>
          ) : (
            values.map((value) => (
              <span className="chip" key={value}>
                {value}
                <button type="button" aria-label={`Remove ${value}`} onClick={() => onRemoveValue(value)}>
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="chip-input-row">
          <input
            value={inputValue}
            list={datalistId}
            onChange={(event) => onInputValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                onCommitValue()
              }
            }}
            onBlur={onCommitValue}
            placeholder={placeholder}
          />
          <button type="button" className="secondary" onClick={onCommitValue}>
            Add
          </button>
        </div>
        {datalistId !== undefined && suggestions !== undefined && suggestions.length > 0 ? (
          <datalist id={datalistId}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        ) : null}
        {suggestions !== undefined && suggestions.length > 0 ? (
          <div className="chip-suggestion-list">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="chip-suggestion"
                onClick={() => onSelectSuggestion?.(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {helperText !== undefined ? <span className="field-help">{helperText}</span> : null}
    </label>
  )
}

function SuggestUpdatePage({
  nickname,
  authToken,
  draft,
  onDraftChange,
  onDownload,
  onCancel,
  onChangeNickname,
}: SuggestUpdatePageProps) {
  const navigate = useNavigate()
  const [originalDraft] = useState(draft)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceMessage, setEnhanceMessage] = useState('')
  const [genreInput, setGenreInput] = useState(draft.genre)
  const [tagInput, setTagInput] = useState('')
  const [metadataSuggestions, setMetadataSuggestions] = useState<SuggestMetadataSuggestionsResponse>({
    genres: [],
    tags: [],
  })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const thumbnailFileInputRef = useRef<HTMLInputElement>(null)
  const previewUrl =
    draft.source_thumbnail_data_url !== '' ? draft.source_thumbnail_data_url : draft.source_thumbnail

  const updateDraft = useCallback(
    (patch: Partial<SuggestDraft>) => {
      const nextDraft = { ...draft, ...patch }
      onDraftChange({
        ...nextDraft,
        genre: nextDraft.genre.trim(),
        tags: normalizeTagList(nextDraft.tags),
      })
    },
    [draft, onDraftChange],
  )

  const commitTags = useCallback(() => {
    const nextValues = splitChipInput(tagInput, (entry) => entry.trim().toLowerCase())
    if (nextValues.length === 0) {
      return
    }

    updateDraft({ tags: normalizeTagList([...draft.tags, ...nextValues]) })
    setTagInput('')
  }, [draft.tags, tagInput, updateDraft])

  useEffect(() => {
    let isStale = false
    void suggestMetadataSuggestions('', authToken)
      .then((payload) => {
        if (isStale) {
          return
        }
        setMetadataSuggestions({
          genres: payload.genres,
          tags: normalizeTagList(payload.tags),
        })
      })
      .catch(() => {
        if (!isStale) {
          setMetadataSuggestions({ genres: [], tags: [] })
        }
      })
    return () => {
      isStale = true
    }
  }, [authToken])

  useEffect(() => {
    const keyword = genreInput.trim()
    if (keyword === '') {
      return
    }

    let isStale = false
    const timeoutId = window.setTimeout(() => {
      void suggestMetadataSuggestions(keyword, authToken)
        .then((payload) => {
          if (isStale) {
            return
          }
          setMetadataSuggestions((current) => ({
            ...current,
            genres: payload.genres,
          }))
        })
        .catch(() => {
          // Keep existing suggestions on transient failures.
        })
    }, 250)

    return () => {
      isStale = true
      window.clearTimeout(timeoutId)
    }
  }, [authToken, genreInput])

  useEffect(() => {
    const keyword = tagInput.trim()
    if (keyword === '') {
      return
    }

    let isStale = false
    const timeoutId = window.setTimeout(() => {
      void suggestMetadataSuggestions(keyword, authToken)
        .then((payload) => {
          if (isStale) {
            return
          }
          setMetadataSuggestions((current) => ({
            ...current,
            tags: normalizeTagList(payload.tags),
          }))
        })
        .catch(() => {
          // Keep existing suggestions on transient failures.
        })
    }, 250)

    return () => {
      isStale = true
      window.clearTimeout(timeoutId)
    }
  }, [authToken, tagInput])

  const handleThumbnailUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null
      if (file === null) {
        return
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        updateDraft({ source_thumbnail_data_url: dataUrl })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load image file')
      } finally {
        event.currentTarget.value = ''
        setContextMenu(null)
      }
    },
    [updateDraft],
  )

  const openLyricsSearch = useCallback(() => {
    const search = `${draft.title.trim()} lyrics`.trim()
    window.open(`https://www.google.com/search?q=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer')
  }, [draft.title])

  const previewOnYoutube = useCallback(() => {
    window.open(draft.source_url, '_blank', 'noopener,noreferrer')
  }, [draft.source_url])

  const handleEnhance = useCallback(async () => {
    setIsEnhancing(true)
    setEnhanceMessage('')
    try {
      const response = await suggestEnhance(draft, authToken)
      if (response.status === 'success' || response.status === 'degraded') {
        // Merge enhanced results back into draft
        const enhanced = response.enhanced
        updateDraft({
          title: enhanced.title,
          artist: enhanced.artist,
          language: enhanced.language || '',
          is_off_vocal: enhanced.is_off_vocal,
          video_has_lyrics: enhanced.video_has_lyrics,
          genre: enhanced.genre || '',
          tags: enhanced.tags || [],
          // Note: source fields and lyrics are not updated per enhancement rules
        })
        setEnhanceMessage(response.status === 'degraded' ? '✓ Enhanced (partial)' : '✓ Enhanced successfully!')
        // Clear message after 3 seconds
        setTimeout(() => setEnhanceMessage(''), 3000)
      } else {
        setEnhanceMessage('Enhancement failed')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Enhancement failed'
      setEnhanceMessage(`Error: ${message}`)
    } finally {
      setIsEnhancing(false)
    }
  }, [draft, authToken, updateDraft])

  const confirmExitUpdate = useCallback(
    (onConfirmed: () => void) => {
      const shouldLeave = window.confirm(
        'Leave Song Details? All current changes will be lost.',
      )
      if (!shouldLeave) {
        return
      }
      clearSuggestDraft()
      onCancel()
      onConfirmed()
    },
    [onCancel],
  )

  return (
    <main className="app-shell">
      <section className="card suggest-update-card">
        <div className="card-header">
          <div>
            <h1>Suggest · Update Details</h1>
            <p className="subtitle">
              Signed in as <strong>{nickname}</strong>
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              disabled={isEnhancing || isSubmitting}
              onClick={() => {
                confirmExitUpdate(() => {
                  onChangeNickname()
                })
              }}
            >
              Change Nickname
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isEnhancing || isSubmitting}
              onClick={() => {
                confirmExitUpdate(() => {
                  navigate('/songbook')
                })
              }}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="row-actions top-gap">
          <button 
            type="button" 
            className="youtube-button" 
            disabled={isEnhancing || isSubmitting}
            onClick={previewOnYoutube}
          >
            Preview on Youtube
          </button>
          <button
            type="button"
            className="secondary"
            disabled={isEnhancing || isSubmitting}
            onClick={handleEnhance}
            title={isEnhancing ? 'Enhancing...' : 'Use AI to enhance song metadata'}
          >
            {isEnhancing ? 'Enhancing...' : 'Enhance'} <span aria-hidden="true">✦</span>
          </button>
          {enhanceMessage && (
            <span className="enhance-message" style={{ color: enhanceMessage.startsWith('Error') ? '#d32f2f' : '#4caf50' }}>
              {enhanceMessage}
            </span>
          )}
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            const submitter = (event.nativeEvent as SubmitEvent).submitter as
              | HTMLButtonElement
              | null
            if (submitter?.dataset.action !== 'download') {
              return
            }
            setErrorMessage('')
            setIsSubmitting(true)
            void suggestDownload(draft, authToken)
              .then(() => {
                onDownload(draft.title)
                clearSuggestDraft()
                setIsSubmitting(false)
                navigate('/songbook')
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Download failed'
                setErrorMessage(message)
                setIsSubmitting(false)
              })
            }}
        >
          <div className="suggest-update-layout">
            <section className="panel thumbnail-panel">
            <h2>Thumbnail</h2>
            <div 
              className="thumbnail-preview"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                setContextMenu({ x: rect.left, y: rect.top + rect.height })
              }}
              style={{ cursor: 'pointer', position: 'relative' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  setContextMenu({ x: rect.left, y: rect.top + rect.height })
                }
              }}
            >
              {previewUrl !== '' ? (
                <img src={previewUrl} alt={draft.title} />
              ) : (
                <div className="thumbnail-placeholder">No thumbnail available</div>
              )}
              <div style={{ position: 'absolute', bottom: 8, right: 8 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 20,
                }}>
                  📷
                </div>
              </div>
            </div>
            
            {contextMenu && (
              <div 
                style={{
                  position: 'fixed',
                  top: contextMenu.y,
                  left: contextMenu.x,
                  backgroundColor: 'var(--surface-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                  zIndex: 1000,
                  minWidth: 180,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    thumbnailFileInputRef.current?.click()
                    setContextMenu(null)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Upload Thumbnail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateDraft({
                      source_thumbnail_data_url: originalDraft.source_thumbnail_data_url,
                      source_thumbnail: originalDraft.source_thumbnail,
                    })
                    setContextMenu(null)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    borderTop: '1px solid var(--border-primary)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-input)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Reset Thumbnail
                </button>
              </div>
            )}
            {contextMenu && (
              <div 
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 999,
                }}
                onClick={() => setContextMenu(null)}
              />
            )}
            
            <input
              ref={thumbnailFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleThumbnailUpload}
              style={{ display: 'none' }}
            />
          </section>

          <section className="panel">
            <h2>Song Details</h2>
            <div className="form">
              <label>
                Title
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  required
                />
              </label>
              <label>
                Artist
                <input
                  value={draft.artist}
                  onChange={(event) => updateDraft({ artist: event.target.value })}
                  required
                />
              </label>
              <label>
                Language
                <input
                  value={draft.language}
                  onChange={(event) => updateDraft({ language: event.target.value })}
                  placeholder="en"
                />
              </label>
              <div className="checkbox-grid">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.is_off_vocal}
                    onChange={(event) => updateDraft({ is_off_vocal: event.target.checked })}
                  />
                  Is Off Vocal
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.video_has_lyrics}
                    onChange={(event) => updateDraft({ video_has_lyrics: event.target.checked })}
                  />
                  Video Has Lyrics
                </label>
              </div>
              <p className="subtitle">
                Source URL:{' '}
                <a href={draft.source_url} target="_blank" rel="noreferrer">
                  {draft.source_url}
                </a>
              </p>
              <p className="subtitle">
                Source ID: <code>{draft.source_id}</code>
              </p>
              <p className="subtitle">
                Source: <code>{draft.source}</code>
              </p>
            </div>
          </section>

          <section className="panel full-span">
            <label>
              Genre
              <input
                value={draft.genre}
                list="genre-suggestions"
                onChange={(event) => {
                  const nextValue = event.target.value
                  setGenreInput(nextValue)
                  updateDraft({ genre: nextValue })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                  }
                }}
                placeholder="Pop, ballad, rock..."
                required
              />
              {metadataSuggestions.genres.length > 0 ? (
                <datalist id="genre-suggestions">
                  {metadataSuggestions.genres
                    .filter((suggestion) => suggestion !== draft.genre)
                    .map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                </datalist>
              ) : null}
              {metadataSuggestions.genres.length > 0 ? (
                <div className="chip-suggestion-list top-gap">
                  {metadataSuggestions.genres
                    .filter((suggestion) => suggestion !== draft.genre)
                    .map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="chip-suggestion"
                        onClick={() => {
                          setGenreInput(suggestion)
                          updateDraft({ genre: suggestion })
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                </div>
              ) : null}
              <span className="field-help">Add at least one genre.</span>
            </label>
            <div className="top-gap">
              <ChipField
                label="Tags"
                values={draft.tags}
                inputValue={tagInput}
                placeholder="romantic, duet, female vocal..."
                helperText="Optional tags (saved as lowercase) separated by commas or Enter."
                datalistId="tag-suggestions"
                suggestions={metadataSuggestions.tags.filter((item) => !draft.tags.includes(item))}
                onInputValueChange={setTagInput}
                onCommitValue={commitTags}
                onSelectSuggestion={(value) => {
                  updateDraft({ tags: normalizeTagList([...draft.tags, value]) })
                  setTagInput('')
                }}
                onRemoveValue={(value) =>
                  updateDraft({ tags: draft.tags.filter((item) => item !== value) })
                }
              />
            </div>
          </section>

          <section className="panel full-span">
            <div className="panel-header">
              <h2>Lyrics</h2>
              <button type="button" className="secondary" onClick={openLyricsSearch}>
                Search Lyrics on Google
              </button>
            </div>
            <label className="top-gap">
              Lyrics
              <textarea
                value={draft.lyrics}
                onChange={(event) => updateDraft({ lyrics: event.target.value })}
                rows={10}
                placeholder="Paste lyrics here..."
              />
            </label>
          </section>
        </div>
        <div className="row-actions top-gap">
          <button
            type="submit"
            data-action="download"
            disabled={isSubmitting || draft.genre.trim() === '' || isEnhancing}
          >
            {isSubmitting ? 'Saving…' : 'Download'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={isEnhancing || isSubmitting}
            onClick={() => {
              confirmExitUpdate(() => {
                navigate('/songbook/suggest/search')
              })
            }}
          >
            Back
          </button>
          {draft.genre.trim() === '' ? (
            <p className="subtitle">Add at least one genre before downloading.</p>
          ) : null}
        </div>
        {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
        </form>
        {isEnhancing || isSubmitting ? (
          <BlockingHud message={isEnhancing ? 'Enhancing song details...' : 'Saving song...'} />
        ) : null}
      </section>
    </main>
  )
}

type LoginPageProps = {
  username: string
  password: string
  errorMessage: string
  isSubmitting: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function LoginPage({
  username,
  password,
  errorMessage,
  isSubmitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginPageProps) {
  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Admin</h1>
        <p className="subtitle">Login to manage karaoke sessions.</p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </label>

          {errorMessage !== '' ? (
            <p className="error-message" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}

type SessionsPageProps = {
  user: UserProfile
  sessions: SessionRecord[]
  newSessionName: string
  isLoadingSessions: boolean
  isSavingSession: boolean
  sessionMessage: string
  errorMessage: string
  onLogout: () => void
  onRefresh: () => void
  onSessionNameChange: (value: string) => void
  onCreateSession: (event: FormEvent<HTMLFormElement>) => void
  onArchiveSession: (sessionId: string) => void
}

function SessionsPage({
  user,
  sessions,
  newSessionName,
  isLoadingSessions,
  isSavingSession,
  sessionMessage,
  errorMessage,
  onLogout,
  onRefresh,
  onSessionNameChange,
  onCreateSession,
  onArchiveSession,
}: SessionsPageProps) {
  const navigate = useNavigate()
  const activeCount = useMemo(
    () => sessions.filter((session) => session.archived_at === null).length,
    [sessions],
  )

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Session Management</h1>
            <p className="subtitle">
              Welcome, <strong>{user.username}</strong> ({user.role})
            </p>
          </div>
          <button type="button" className="secondary" onClick={onLogout}>
            Logout
          </button>
        </div>

        <div className="metrics">
          <div>
            <span className="metric-label">Total sessions</span>
            <strong>{sessions.length}</strong>
          </div>
          <div>
            <span className="metric-label">Active sessions</span>
            <strong>{activeCount}</strong>
          </div>
        </div>

        <form className="form inline-form" onSubmit={onCreateSession}>
          <label>
            New session name
            <input
              value={newSessionName}
              onChange={(event) => onSessionNameChange(event.target.value)}
              placeholder="Friday Karaoke Night"
              required
            />
          </label>
          <button type="submit" disabled={isSavingSession}>
            {isSavingSession ? 'Creating…' : 'Create session'}
          </button>
        </form>

        {sessionMessage !== '' ? <p className="success-message">{sessionMessage}</p> : null}
        {errorMessage !== '' ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="list-header">
          <h2>Sessions</h2>
          <button type="button" className="secondary" onClick={onRefresh} disabled={isLoadingSessions}>
            {isLoadingSessions ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <p className="empty-state">No sessions yet.</p>
          ) : (
            sessions.map((session) => {
              const isActive = session.archived_at === null
              return (
                <article className="session-row" key={session.id}>
                  <div>
                    <div className="session-title">
                      <strong>{session.name}</strong>
                      <span className={`badge ${isActive ? 'active' : 'inactive'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="session-meta">
                      Code: <code>{session.session_code}</code> · Created{' '}
                      {new Date(session.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!isActive}
                      onClick={() => navigate(`/admin/sessions/${session.session_code}`)}
                    >
                      Open controls
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!isActive}
                      onClick={() => onArchiveSession(session.id)}
                    >
                      {isActive ? 'Mark inactive' : 'Archived'}
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}

type SessionControlPageProps = {
  auth: StoredAuth
  sessions: SessionRecord[]
  onRefreshSessions: () => void
  onArchiveSession: (sessionId: string) => void
}

function SessionControlPage({
  auth,
  sessions,
  onRefreshSessions,
  onArchiveSession,
}: SessionControlPageProps) {
  const navigate = useNavigate()
  const params = useParams<{ sessionCode: string }>()
  const sessionCode = params.sessionCode ?? ''
  const [socketStatus, setSocketStatus] = useState('Connecting...')
  const [queueItems, setQueueItems] = useState<SongQueueItem[]>(INITIAL_MOCK_QUEUE)
  const [downloadsCount, setDownloadsCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    positionSeconds: 0,
  })
  const [wsMessage, setWsMessage] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const shouldReconnectRef = useRef(true)
  const refreshSessionsRef = useRef(onRefreshSessions)

  const session = useMemo(
    () =>
      sessions.find(
        (entry) =>
          entry.session_code === sessionCode && entry.archived_at === null,
      ) ?? null,
    [sessionCode, sessions],
  )
  const activeSessionCode = session?.session_code ?? null

  useEffect(() => {
    refreshSessionsRef.current = onRefreshSessions
  }, [onRefreshSessions])

  const sendCommand = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const socket = socketRef.current
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      setWsMessage('WebSocket is not connected.')
      return
    }

    socket.send(
      JSON.stringify({
        type,
        session_code: sessionCode,
        payload,
      }),
    )
  }, [sessionCode])

  useEffect(() => {
    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const closeSocket = () => {
      const currentSocket = socketRef.current
      if (currentSocket !== null) {
        currentSocket.onopen = null
        currentSocket.onclose = null
        currentSocket.onerror = null
        currentSocket.onmessage = null
        currentSocket.close()
        socketRef.current = null
      }
    }

    if (activeSessionCode === null) {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
      setSocketStatus('Session not found or inactive.')
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

      const wsUrl = buildWSUrl('/ws/admin', {
        session_code: activeSessionCode,
        token: auth.accessToken,
      })
      setSocketStatus('Connecting...')
      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setSocketStatus('Connected')
        setWsMessage('')
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
        let payload: WSIncoming
        try {
          payload = JSON.parse(event.data) as WSIncoming
        } catch {
          return
        }

        if (payload.type === 'queue.updated') {
          const items = payload.payload.items
          if (Array.isArray(items)) {
            setQueueItems(items as SongQueueItem[])
          }
          return
        }

        if (payload.type === 'downloads.updated') {
          const items = payload.payload.items
          if (Array.isArray(items)) {
            setDownloadsCount(items.length)
          }
          return
        }

        if (payload.type === 'playback.position') {
          const nextPosition = Number(payload.payload.position_seconds ?? 0)
          setPlaybackState((previous) => ({
            ...previous,
            positionSeconds: Number.isFinite(nextPosition) ? nextPosition : previous.positionSeconds,
          }))
          return
        }

        if (payload.type === 'playback.ended') {
          setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
          setWsMessage('Player reported playback ended.')
          return
        }

        if (payload.type === 'session.ended') {
          shouldReconnectRef.current = false
          clearReconnectTimer()
          closeSocket()
          setWsMessage('Session ended. Returning to sessions.')
          refreshSessionsRef.current()
          window.setTimeout(() => navigate('/admin/sessions'), 500)
          return
        }

        if (payload.type === 'error') {
          const message = payload.payload.message
          if (typeof message === 'string') {
            setWsMessage(message)
          }
        }
      }
    }

    connectSocket()

    return () => {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      closeSocket()
    }
  }, [activeSessionCode, auth.accessToken, navigate])

  if (session === null) {
    return (
      <main className="app-shell">
        <section className="card">
          <h1>Session Control</h1>
          <p className="error-message">Session not found or inactive.</p>
          <button type="button" className="secondary" onClick={() => navigate('/admin/sessions')}>
            Back to sessions
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="card session-control-card">
        <div className="card-header">
          <div>
            <h1>{session.name}</h1>
            <p className="subtitle">
              Session code: <code>{session.session_code}</code>
            </p>
            <p className="subtitle">WebSocket: {socketStatus}</p>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => navigate('/admin/sessions')}>
              Back
            </button>
            <button type="button" className="secondary" onClick={() => onArchiveSession(session.id)}>
              End session
            </button>
          </div>
        </div>

        {wsMessage !== '' ? <p className="success-message">{wsMessage}</p> : null}

        <div className="control-layout">
          <section className="panel">
            <h2>Playback</h2>
            <p className="subtitle">
              State: {playbackState.isPlaying ? 'Playing' : 'Paused'} · Position:{' '}
              {playbackState.positionSeconds.toFixed(1)}s
            </p>
            <div className="playback-actions">
              <button type="button" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, isPlaying: true }))
                sendCommand('playback.play')
              }}>
                Play
              </button>
              <button type="button" className="secondary" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, isPlaying: false }))
                sendCommand('playback.pause')
              }}>
                Pause
              </button>
              <button type="button" className="secondary" onClick={() => {
                setPlaybackState((previous) => ({ ...previous, positionSeconds: 0 }))
                sendCommand('playback.skip')
              }}>
                Skip
              </button>
              <button type="button" className="secondary" onClick={() => {
                const nextPosition = playbackState.positionSeconds + 10
                setPlaybackState((previous) => ({ ...previous, positionSeconds: nextPosition }))
                sendCommand('playback.seek', { position_seconds: nextPosition })
              }}>
                Seek +10s
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Queued Songs</h2>
              <button type="button" className="secondary" onClick={() => setWsMessage('Songbook is mocked for now.')}>
                Songbook
              </button>
            </div>
            <p className="subtitle">Download queue: {downloadsCount}</p>
            <div className="queue-list">
              {queueItems.length === 0 ? (
                <p className="empty-state">No queued songs.</p>
              ) : (
                queueItems.map((song) => (
                  <article className="queue-item" key={song.id}>
                    <strong>{song.title}</strong>
                    <p className="session-meta">
                      {song.artist} · {song.status}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

type SuggestSearchRouteProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
}

function SuggestSearchRoute({
  nickname,
  authToken,
  onCancel,
  onChangeNickname,
}: SuggestSearchRouteProps) {
  const navigate = useNavigate()

  return (
    <SuggestSearchPage
      nickname={nickname}
      authToken={authToken}
      onCancel={onCancel}
      onChangeNickname={onChangeNickname}
      onIdentify={(sourceUrl) => {
        navigate(`/songbook/suggest/identify?url=${encodeURIComponent(sourceUrl)}`)
      }}
    />
  )
}

function AppShell() {
  const [auth, setAuth] = useState<StoredAuth | null>(null)
  const [isHydratingAuth, setIsHydratingAuth] = useState(true)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('password')
  const [loginErrorMessage, setLoginErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isSavingSession, setIsSavingSession] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')
  const [suggestAuth, setSuggestAuth] = useState<GuestAuth | null>(null)
  const [suggestNickname, setSuggestNickname] = useState('')
  const [suggestDraft, setSuggestDraft] = useState<SuggestDraft | null>(() => readSuggestDraft())
  const [songbookNotice, setSongbookNotice] = useState('')

  const loadSessions = useCallback(async (token: string) => {
    setIsLoadingSessions(true)
    setSessionErrorMessage('')
    try {
      const payload = await apiJson<SessionRecord[]>('/sessions', {}, token)
      setSessions(payload)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        setSessions([])
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error loading sessions'
      setSessionErrorMessage(message)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    const storedSuggestAuth = readSuggestAuth()
    if (storedSuggestAuth !== null) {
      setSuggestAuth(storedSuggestAuth)
      setSuggestNickname(storedSuggestAuth.nickname)
      return
    }

    setSuggestNickname(readSuggestNickname())
  }, [])

  useEffect(() => {
    if (suggestDraft === null) {
      clearSuggestDraft()
      return
    }

    saveSuggestDraft(suggestDraft)
  }, [suggestDraft])

  useEffect(() => {
    const storedAuth = readStoredAuth()
    if (storedAuth === null) {
      setIsHydratingAuth(false)
      return
    }

    let cancelled = false

    const hydrate = async () => {
      try {
        const user = await apiJson<UserProfile>('/users/me', {}, storedAuth.accessToken)
        if (cancelled) {
          return
        }

        const nextAuth = { accessToken: storedAuth.accessToken, user }
        saveStoredAuth(nextAuth)
        setAuth(nextAuth)
      } catch {
        clearStoredAuth()
        if (!cancelled) {
          setAuth(null)
        }
      } finally {
        if (!cancelled) {
          setIsHydratingAuth(false)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (auth === null) {
      setSessions([])
      return
    }

    void loadSessions(auth.accessToken)
  }, [auth, loadSessions])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginErrorMessage('')
    setIsSubmitting(true)

    try {
      const payload = await apiJson<LoginResponse>('/users/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })

      const nextAuth = {
        accessToken: payload.access_token,
        user: payload.user,
      }
      saveStoredAuth(nextAuth)
      setAuth(nextAuth)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error during login'
      setLoginErrorMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = async () => {
    if (auth === null) {
      return
    }

    try {
      await apiJson<{ message: string }>('/users/logout', {
        method: 'POST',
        body: JSON.stringify({ username: auth.user.username }),
      }, auth.accessToken)
    } catch {
      // Logout is best-effort; local auth state still clears.
    } finally {
      clearStoredAuth()
      setAuth(null)
      setSessions([])
      setNewSessionName('')
      setSessionMessage('')
      setSessionErrorMessage('')
      setLoginErrorMessage('')
    }
  }

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (auth === null) {
      return
    }

    setSessionMessage('')
    setSessionErrorMessage('')
    setIsSavingSession(true)

    try {
      await apiJson<SessionRecord>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: newSessionName }),
      }, auth.accessToken)

      setNewSessionName('')
      setSessionMessage('Session created.')
      await loadSessions(auth.accessToken)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error creating session'
      setSessionErrorMessage(message)
    } finally {
      setIsSavingSession(false)
    }
  }

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    if (auth === null) {
      return
    }

    setSessionMessage('')
    setSessionErrorMessage('')

    try {
      const payload = await apiJson<SessionArchiveResponse>(`/sessions/${sessionId}/archive`, {
        method: 'PATCH',
      }, auth.accessToken)

      setSessionMessage(`${payload.session.session_code} archived.`)
      await loadSessions(auth.accessToken)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredAuth()
        setAuth(null)
        return
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected error archiving session'
      setSessionErrorMessage(message)
    }
  }, [auth, loadSessions])

  const hasSuggestAuth = suggestAuth !== null

  const handleSuggestLogin = useCallback(async (nickname: string) => {
    const cleaned = nickname.trim()
    const guestAuth = await guestLoginWithNickname(cleaned)
    setSuggestAuth(guestAuth)
    setSuggestNickname(guestAuth.nickname)
    saveSuggestNickname(guestAuth.nickname)
    saveSuggestAuth(guestAuth)
  }, [])

  const handleSelectSuggestDraft = useCallback((draft: SuggestDraft) => {
    setSuggestDraft(draft)
  }, [])

  const handleDownloadSuggestion = useCallback((title: string) => {
    setSongbookNotice(`${title} is now downloading!`)
    setSuggestDraft(null)
  }, [])

  const handleCancelSuggestion = useCallback(() => {
    setSuggestDraft(null)
  }, [])

  const handleChangeSuggestNickname = useCallback(() => {
    clearSuggestAuth()
    clearSuggestNickname()
    setSuggestAuth(null)
    setSuggestNickname('')
    setSuggestDraft(null)
    setSongbookNotice('Nickname cleared. Sign in again to continue suggesting songs.')
  }, [])

  if (isHydratingAuth) {
    return <LoadingView />
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/guest" replace />}
        />
        <Route
          path="/admin"
          element={<Navigate to={auth === null ? '/admin/login' : '/admin/sessions'} replace />}
        />
        <Route
          path="/admin/login"
          element={
            auth !== null ? (
              <Navigate to="/admin/sessions" replace />
            ) : (
              <LoginPage
                username={username}
                password={password}
                errorMessage={loginErrorMessage}
                isSubmitting={isSubmitting}
                onUsernameChange={setUsername}
                onPasswordChange={setPassword}
                onSubmit={handleLogin}
              />
            )
          }
        />
        <Route
          path="/guest"
          element={<GuestPage />}
        />
        <Route
          path="/songbook"
          element={
            <SongbookPage
              notice={songbookNotice}
              guestNickname={suggestAuth?.nickname ?? null}
              onChangeNickname={handleChangeSuggestNickname}
            />
          }
        />
        <Route
          path="/songbook/song/:id"
          element={<SongDetailPage />}
        />
        <Route
          path="/songbook/suggest/login"
          element={
            hasSuggestAuth ? (
              <Navigate to="/songbook/suggest/search" replace />
            ) : (
              <SuggestLoginPage
                initialNickname={suggestNickname}
                onLogin={handleSuggestLogin}
              />
            )
          }
        />
        <Route
          path="/songbook/suggest/search"
          element={
            !hasSuggestAuth ? (
              <Navigate to="/songbook/suggest/login" replace />
            ) : (
              <SuggestSearchRoute
                nickname={suggestAuth.nickname}
                authToken={suggestAuth.accessToken}
                onCancel={handleCancelSuggestion}
                onChangeNickname={handleChangeSuggestNickname}
              />
            )
          }
        />
        <Route
          path="/songbook/suggest/identify"
          element={
            !hasSuggestAuth ? (
              <Navigate to="/songbook/suggest/login" replace />
            ) : (
              <SuggestIdentifyPage
                nickname={suggestAuth.nickname}
                authToken={suggestAuth.accessToken}
                onIdentify={handleSelectSuggestDraft}
                onCancel={handleCancelSuggestion}
                onChangeNickname={handleChangeSuggestNickname}
              />
            )
          }
        />
        <Route
          path="/songbook/suggest/update"
          element={
            !hasSuggestAuth ? (
              <Navigate to="/songbook/suggest/login" replace />
            ) : suggestDraft === null ? (
              <Navigate to="/songbook/suggest/search" replace />
            ) : (
              <SuggestUpdatePage
                nickname={suggestAuth.nickname}
                authToken={suggestAuth.accessToken}
                draft={suggestDraft}
                onDraftChange={setSuggestDraft}
                onDownload={handleDownloadSuggestion}
                onCancel={handleCancelSuggestion}
                onChangeNickname={handleChangeSuggestNickname}
              />
            )
          }
        />
        <Route
          path="/admin/sessions"
          element={
            auth === null ? (
              <Navigate to="/admin/login" replace />
            ) : (
              <SessionsPage
                user={auth.user}
                sessions={sessions}
                newSessionName={newSessionName}
                isLoadingSessions={isLoadingSessions}
                isSavingSession={isSavingSession}
                sessionMessage={sessionMessage}
                errorMessage={sessionErrorMessage}
                onLogout={handleLogout}
                onRefresh={() => {
                  void loadSessions(auth.accessToken)
                }}
                onSessionNameChange={setNewSessionName}
                onCreateSession={handleCreateSession}
                onArchiveSession={(sessionId) => {
                  void handleArchiveSession(sessionId)
                }}
              />
            )
          }
        />
        <Route
          path="/admin/sessions/:sessionCode"
          element={
            auth === null ? (
              <Navigate to="/admin/login" replace />
            ) : (
              <SessionControlPage
                auth={auth}
                sessions={sessions}
                onRefreshSessions={() => {
                  void loadSessions(auth.accessToken)
                }}
                onArchiveSession={(sessionId) => {
                  void handleArchiveSession(sessionId)
                }}
              />
            )
          }
        />
        <Route
          path="*"
          element={<Navigate to="/guest" replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default AppShell
