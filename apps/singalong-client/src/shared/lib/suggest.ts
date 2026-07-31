import { SUGGEST_KEYWORD_REGEX, YOUTUBE_URL_REGEX } from '../config/client'
import type { SuggestDraft, SuggestIdentifyResponse, SuggestResult, SuggestSearchResponse } from '../types/client'

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

export function mapSuggestSearchItem(item: SuggestSearchResponse['results'][number]): SuggestResult {
  return {
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
    existingSongId: item.existing_song_id,
    sourceUrl: item.source_url,
    youtubeId: item.youtube_id,
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

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] === 'watch') {
      const id = url.searchParams.get('v') ?? ''
      return id !== '' ? id : null
    }

    if (segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed') {
      const id = segments[1] ?? ''
      return id !== '' ? id : null
    }

    return null
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
