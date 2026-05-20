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

type SongbookSong = {
  id: string
  title: string
  artist: string
  language: string
  duration: string
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
  title: string
  artist: string
  source_url: string
  youtube_id: string
  thumbnail_url: string
  thumbnail_data_url: string
  channel_name: string
  description: string
}

type SuggestUpdateResponse = {
  status: string
  message: string
  draft: SuggestIdentifyResponse
}

type SuggestDraft = {
  title: string
  artist: string
  sourceUrl: string
  youtubeId: string
  thumbnailUrl: string
  thumbnailDataUrl: string
  language: string
  isOffVocal: boolean
  hasLyrics: boolean
  genres: string[]
  tags: string[]
  lyrics: string
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

const MOCK_SONGBOOK: SongbookSong[] = [
  { id: 'song-1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', language: 'en', duration: '3:33' },
  { id: 'song-2', title: 'Mijuku DREAMER', artist: 'Aqours', language: 'jp', duration: '4:31' },
  { id: 'song-3', title: 'Bohemian Rhapsody', artist: 'Queen', language: 'en', duration: '5:55' },
  { id: 'song-4', title: 'Dancing Queen', artist: 'ABBA', language: 'en', duration: '3:51' },
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

function readSuggestDraft(): SuggestDraft | null {
  const raw = window.localStorage.getItem(SUGGEST_DRAFT_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SuggestDraft>
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
        title: parsed.title,
        artist: parsed.artist,
        sourceUrl: parsed.sourceUrl,
        youtubeId: parsed.youtubeId,
        thumbnailUrl: parsed.thumbnailUrl,
        thumbnailDataUrl: parsed.thumbnailDataUrl,
        language: parsed.language,
        isOffVocal: parsed.isOffVocal,
        hasLyrics: parsed.hasLyrics,
        genres: parsed.genres,
        tags: parsed.tags,
        lyrics: parsed.lyrics,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(SUGGEST_DRAFT_STORAGE_KEY)
  return null
}

function saveSuggestDraft(draft: SuggestDraft) {
  window.localStorage.setItem(SUGGEST_DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

function clearSuggestDraft() {
  window.localStorage.removeItem(SUGGEST_DRAFT_STORAGE_KEY)
}

function buildInitialSuggestDraft(payload: SuggestIdentifyResponse): SuggestDraft {
  return {
    title: payload.title,
    artist: payload.artist,
    sourceUrl: payload.source_url,
    youtubeId: payload.youtube_id,
    thumbnailUrl: payload.thumbnail_url,
    thumbnailDataUrl: payload.thumbnail_data_url,
    language: '',
    isOffVocal: false,
    hasLyrics: false,
    genres: [],
    tags: [],
    lyrics: '',
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

function splitChipInput(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
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

async function suggestIdentify(url: string, token: string): Promise<SuggestIdentifyResponse> {
  return apiJson<SuggestIdentifyResponse>(
    '/songs/suggest/identify',
    {
      method: 'POST',
      body: JSON.stringify({ url }),
    },
    token,
  )
}

async function suggestUpdate(draft: SuggestDraft, token: string): Promise<SuggestUpdateResponse> {
  return apiJson<SuggestUpdateResponse>(
    '/songs/suggest/update',
    {
      method: 'POST',
      body: JSON.stringify({
        title: draft.title,
        artist: draft.artist,
        source_url: draft.sourceUrl,
        youtube_id: draft.youtubeId,
        thumbnail_url: draft.thumbnailUrl,
        thumbnail_data_url: draft.thumbnailDataUrl,
        language: draft.language,
        is_off_vocal: draft.isOffVocal,
        has_lyrics: draft.hasLyrics,
        genres: draft.genres,
        tags: draft.tags,
        lyrics: draft.lyrics,
      }),
    },
    token,
  )
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
  return `${WS_BASE}${path}?${query}`
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

type SongbookPageProps = {
  notice: string
  guestNickname: string | null
  onChangeNickname: () => void
}

function SongbookPage({ notice, guestNickname, onChangeNickname }: SongbookPageProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const filteredSongs = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (trimmed === '') {
      return MOCK_SONGBOOK
    }

    return MOCK_SONGBOOK.filter(
      (song) =>
        song.title.toLowerCase().includes(trimmed) ||
        song.artist.toLowerCase().includes(trimmed),
    )
  }, [query])

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card-header">
          <div>
            <h1>Songbook</h1>
            <p className="subtitle">Search existing songs before suggesting a new one.</p>
            {guestNickname !== null ? (
              <p className="subtitle top-gap">
                Suggesting as <strong>{guestNickname}</strong>
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            {guestNickname !== null ? (
              <button type="button" className="secondary" onClick={onChangeNickname}>
                Change Nickname
              </button>
            ) : null}
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
          <label>
            Search songbook
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title or artist"
            />
          </label>
        </div>

        <div className="queue-list top-gap">
          {filteredSongs.length === 0 ? (
            <p className="empty-state">No songs found. Try suggesting a new one.</p>
          ) : (
            filteredSongs.map((song) => (
              <article className="queue-item" key={song.id}>
                <strong>{song.title}</strong>
                <p className="session-meta">
                  {song.artist} · {song.language.toUpperCase()} · {song.duration}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
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
  const [errorMessage, setErrorMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)

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
          {results.length === 0 ? (
            <p className="empty-state">Search for a video to see results.</p>
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
                    <p className="search-result-exists">✔ Already Exists</p>
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
                    onIdentify(menuResult.sourceUrl)
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
            onIdentify={onIdentify}
          />
        ) : null}
      </section>
    </main>
  )
}

type SearchResultModalProps = {
  result: SuggestResult
  onClose: () => void
  onIdentify: (sourceUrl: string) => void
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
                ? 'Already Exists'
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
            onClick={() => onIdentify(result.sourceUrl)}
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

      void suggestIdentify(normalizedUrl, authToken)
        .then((response) => {
          onIdentify(
            buildInitialSuggestDraft({
              title: response.title,
              artist: response.artist,
              source_url: response.source_url,
              youtube_id: response.youtube_id,
              thumbnail_url: response.thumbnail_url,
              thumbnail_data_url: response.thumbnail_data_url,
              channel_name: response.channel_name,
              description: response.description,
            }),
          )
          navigate('/songbook/suggest/update', { replace: true })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Identify failed'
          setErrorMessage(message)
        })
        .finally(() => {
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
      </section>
    </main>
  )
}

type SuggestUpdatePageProps = {
  nickname: string
  authToken: string
  draft: SuggestDraft
  onDraftChange: (draft: SuggestDraft) => void
  onDownload: () => void
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
  onInputValueChange: (value: string) => void
  onCommitValue: () => void
  onRemoveValue: (value: string) => void
}

function ChipField({
  label,
  values,
  inputValue,
  placeholder,
  helperText,
  required,
  onInputValueChange,
  onCommitValue,
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
  const [genreInput, setGenreInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const previewUrl = draft.thumbnailDataUrl !== '' ? draft.thumbnailDataUrl : draft.thumbnailUrl
  const isDirty = useMemo(
    () =>
      draft.title !== originalDraft.title ||
      draft.artist !== originalDraft.artist ||
      draft.sourceUrl !== originalDraft.sourceUrl ||
      draft.youtubeId !== originalDraft.youtubeId ||
      draft.thumbnailUrl !== originalDraft.thumbnailUrl ||
      draft.thumbnailDataUrl !== originalDraft.thumbnailDataUrl ||
      draft.language !== originalDraft.language ||
      draft.isOffVocal !== originalDraft.isOffVocal ||
      draft.hasLyrics !== originalDraft.hasLyrics ||
      draft.lyrics !== originalDraft.lyrics ||
      draft.genres.join('|') !== originalDraft.genres.join('|') ||
      draft.tags.join('|') !== originalDraft.tags.join('|'),
    [draft, originalDraft],
  )

  const updateDraft = useCallback(
    (patch: Partial<SuggestDraft>) => {
      onDraftChange({ ...draft, ...patch })
    },
    [draft, onDraftChange],
  )

  const commitGenres = useCallback(() => {
    const nextValues = splitChipInput(genreInput)
    if (nextValues.length === 0) {
      return
    }

    updateDraft({ genres: Array.from(new Set([...draft.genres, ...nextValues])) })
    setGenreInput('')
  }, [draft.genres, genreInput, updateDraft])

  const commitTags = useCallback(() => {
    const nextValues = splitChipInput(tagInput)
    if (nextValues.length === 0) {
      return
    }

    updateDraft({ tags: Array.from(new Set([...draft.tags, ...nextValues])) })
    setTagInput('')
  }, [draft.tags, tagInput, updateDraft])

  const handleThumbnailUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null
      if (file === null) {
        return
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        updateDraft({ thumbnailDataUrl: dataUrl })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load image file')
      } finally {
        event.currentTarget.value = ''
      }
    },
    [updateDraft],
  )

  const openLyricsSearch = useCallback(() => {
    const search = `${draft.title.trim()} lyrics`.trim()
    window.open(`https://www.google.com/search?q=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer')
  }, [draft.title])

  const previewOnYoutube = useCallback(() => {
    window.open(draft.sourceUrl, '_blank', 'noopener,noreferrer')
  }, [draft.sourceUrl])

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
            <button type="button" className="secondary" onClick={onChangeNickname}>
              Change Nickname
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (isDirty) {
                  const shouldLeave = window.confirm(
                    'You have unsaved changes. Cancel and go back to songbook?',
                  )
                  if (!shouldLeave) {
                    return
                  }
                }
                onCancel()
                navigate('/songbook')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="row-actions top-gap">
          <button type="button" className="youtube-button" onClick={previewOnYoutube}>
            Preview on Youtube
          </button>
          <button type="button" className="secondary" disabled title="Coming soon">
            Enhance <span aria-hidden="true">✦</span>
          </button>
        </div>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            setErrorMessage('')
            setIsSubmitting(true)
            void suggestUpdate(draft, authToken)
              .then(() => {
                onDownload()
                navigate('/songbook')
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Update failed'
                setErrorMessage(message)
              })
              .finally(() => {
                setIsSubmitting(false)
              })
          }}
        >
          <div className="suggest-update-layout">
            <section className="panel thumbnail-panel">
            <h2>Thumbnail</h2>
            <div className="thumbnail-preview">
              {previewUrl !== '' ? (
                <img src={previewUrl} alt={draft.title} />
              ) : (
                <div className="thumbnail-placeholder">No thumbnail available</div>
              )}
            </div>
            <label className="file-input-label">
              Change thumbnail
              <input type="file" accept="image/*" onChange={handleThumbnailUpload} />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                updateDraft({
                  thumbnailDataUrl: originalDraft.thumbnailDataUrl,
                  thumbnailUrl: originalDraft.thumbnailUrl,
                })
              }
            >
              Reset thumbnail
            </button>
          </section>

          <section className="panel">
            <h2>Metadata</h2>
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
                    checked={draft.isOffVocal}
                    onChange={(event) => updateDraft({ isOffVocal: event.target.checked })}
                  />
                  Is Off Vocal
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.hasLyrics}
                    onChange={(event) => updateDraft({ hasLyrics: event.target.checked })}
                  />
                  Video Has Lyrics
                </label>
              </div>
              <p className="subtitle">
                Source URL:{' '}
                <a href={draft.sourceUrl} target="_blank" rel="noreferrer">
                  {draft.sourceUrl}
                </a>
              </p>
              <p className="subtitle">
                YouTube ID: <code>{draft.youtubeId}</code>
              </p>
            </div>
          </section>

          <section className="panel full-span">
            <ChipField
              label="Genre"
              values={draft.genres}
              inputValue={genreInput}
              placeholder="Pop, ballad, rock..."
              helperText="Add at least one genre."
              required
              onInputValueChange={setGenreInput}
              onCommitValue={commitGenres}
              onRemoveValue={(value) =>
                updateDraft({ genres: draft.genres.filter((item) => item !== value) })
              }
            />
            <div className="top-gap">
              <ChipField
                label="Tags"
                values={draft.tags}
                inputValue={tagInput}
                placeholder="romantic, duet, female vocal..."
                helperText="Optional tags separated by commas or Enter."
                onInputValueChange={setTagInput}
                onCommitValue={commitTags}
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
          <button type="submit" disabled={isSubmitting || draft.genres.length === 0}>
            {isSubmitting ? 'Saving…' : 'Download'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (isDirty) {
                const shouldLeave = window.confirm(
                  'You have unsaved changes. Go back to search anyway?',
                )
                if (!shouldLeave) {
                  return
                }
              }
              navigate('/songbook/suggest/search')
            }}
          >
            Back
          </button>
          {draft.genres.length === 0 ? (
            <p className="subtitle">Add at least one genre before downloading.</p>
          ) : null}
        </div>
        {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
        </form>
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

  const handleDownloadSuggestion = useCallback(() => {
    setSongbookNotice('Suggestion queued. You can now return to browsing the songbook.')
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
