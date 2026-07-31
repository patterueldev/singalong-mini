import type { LanguageCode } from '../types/client'

export const AUTH_STORAGE_KEY = 'singalong-client-admin-auth'
export const GUEST_AUTH_STORAGE_KEY = 'singalong-client-guest-auth'
export const GUEST_SESSION_CODE_STORAGE_KEY = 'singalong-client-guest-session-code'
export const SUGGEST_STORAGE_KEY = 'singalong-client-suggest-nickname'
export const SUGGEST_AUTH_STORAGE_KEY = 'singalong-client-suggest-auth'
export const SUGGEST_DRAFT_STORAGE_KEY = 'singalong-client-suggest-draft'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin
export const API_ROOT =
  API_BASE_URL.endsWith('/api') || API_BASE_URL.endsWith('/api/')
    ? API_BASE_URL.replace(/\/$/, '')
    : `${API_BASE_URL.replace(/\/$/, '')}/api`
export const HTTP_BASE = API_ROOT.replace(/\/api$/, '')
export const WS_BASE = HTTP_BASE.replace(/^http/i, 'ws')

export const PLAYER_ENCOURAGEMENTS = [
  'Fantastic!',
  'Amazing!',
  'Incredible!',
  'Great job!',
  'Awesome!',
]

export const NICKNAME_REGEX = /^[A-Za-z0-9_]+$/
export const SUGGEST_KEYWORD_REGEX = /\b(karaoke|instrumental|off[\s-]?vocal)\b|カラオケ/i
export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'other', label: 'Others' },
]
export const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?([a-z0-9-]+\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/|embed\/)[A-Za-z0-9_-]{6,}|youtu\.be\/[A-Za-z0-9_-]{6,})([^\s]*)$/i
