import { SUGGEST_KEYWORD_REGEX, YOUTUBE_URL_REGEX } from '../config/client'
import type { SuggestDraft, SuggestIdentifyResponse } from '../types/client'

export function normalizeTagList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ''),
    ),
  )
}

export function buildInitialSuggestDraft(payload: SuggestIdentifyResponse): SuggestDraft {
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
    isEnhanced: false,
    isLikelySong: payload.is_likely_song,
    contentConfidence: payload.content_confidence,
    contentNotice: payload.content_notice,
  }
}

export function normalizeSuggestQuery(query: string): { effectiveQuery: string; appendedKaraoke: boolean } {
  const trimmed = query.trim()
  if (trimmed === '') {
    return { effectiveQuery: '', appendedKaraoke: false }
  }

  if (SUGGEST_KEYWORD_REGEX.test(trimmed)) {
    return { effectiveQuery: trimmed, appendedKaraoke: false }
  }

  return { effectiveQuery: `${trimmed} karaoke`, appendedKaraoke: true }
}

export function parseYouTubeVideoId(input: string): string | null {
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

export function splitChipInput(value: string, transform?: (entry: string) => string): string[] {
  const normalizeEntry = transform ?? ((entry: string) => entry.trim())
  return value
    .split(',')
    .map((entry) => normalizeEntry(entry))
    .filter((entry) => entry !== '')
}
