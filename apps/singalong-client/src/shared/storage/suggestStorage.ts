import {
  NICKNAME_REGEX,
  SUGGEST_AUTH_STORAGE_KEY,
  SUGGEST_DRAFT_STORAGE_KEY,
  SUGGEST_STORAGE_KEY,
} from '../config/client'
import { normalizeTagList } from '../lib/suggest'
import type { GuestAuth, SuggestDraft, UserProfile } from '../types/client'

export function isValidSuggestNickname(value: string): boolean {
  return NICKNAME_REGEX.test(value)
}

export function readSuggestNickname(): string {
  const value = window.localStorage.getItem(SUGGEST_STORAGE_KEY) ?? ''
  return isValidSuggestNickname(value) ? value : ''
}

export function saveSuggestNickname(nickname: string) {
  window.localStorage.setItem(SUGGEST_STORAGE_KEY, nickname)
}

export function clearSuggestNickname() {
  window.localStorage.removeItem(SUGGEST_STORAGE_KEY)
}

export function readSuggestAuth(): GuestAuth | null {
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

export function saveSuggestAuth(auth: GuestAuth) {
  window.localStorage.setItem(SUGGEST_AUTH_STORAGE_KEY, JSON.stringify(auth))
}

export function clearSuggestAuth() {
  window.localStorage.removeItem(SUGGEST_AUTH_STORAGE_KEY)
}

export function readSuggestDraft(): SuggestDraft | null {
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

export function saveSuggestDraft(draft: SuggestDraft) {
  window.localStorage.setItem(
    SUGGEST_DRAFT_STORAGE_KEY,
    JSON.stringify({
      ...draft,
      genre: draft.genre.trim(),
      tags: normalizeTagList(draft.tags),
    }),
  )
}

export function clearSuggestDraft() {
  window.localStorage.removeItem(SUGGEST_DRAFT_STORAGE_KEY)
}
