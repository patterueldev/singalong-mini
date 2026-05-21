import { apiJson } from '../../../shared/api/httpClient'
import { normalizeTagList } from '../../../shared/lib/suggest'
import type {
  SuggestDraft,
  SuggestEnhanceResponse,
  SuggestIdentifyResponse,
  SuggestMetadataSuggestionsResponse,
  SuggestSearchResponse,
} from '../../../shared/types/client'

export interface SuggestService {
  search: (query: string, token: string) => Promise<SuggestSearchResponse>
  identify: (url: string, token: string, enhance?: boolean) => Promise<SuggestIdentifyResponse>
  download: (draft: SuggestDraft, token: string) => Promise<{ status: string; message: string; song_id: string }>
  enhance: (draft: SuggestDraft, token: string) => Promise<SuggestEnhanceResponse>
  metadataSuggestions: (keyword: string, token: string) => Promise<SuggestMetadataSuggestionsResponse>
}

export function search(query: string, token: string): Promise<SuggestSearchResponse> {
  return apiJson<SuggestSearchResponse>(
    `/songs/suggest/search?keyword=${encodeURIComponent(query)}&limit=20`,
    {
      method: 'POST',
      body: JSON.stringify({ query, limit: 20 }),
    },
    token,
  )
}

export function identify(url: string, token: string, enhance: boolean = false): Promise<SuggestIdentifyResponse> {
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

export function download(
  draft: SuggestDraft,
  token: string,
): Promise<{ status: string; message: string; song_id: string }> {
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

export function enhance(draft: SuggestDraft, token: string): Promise<SuggestEnhanceResponse> {
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

export function metadataSuggestions(keyword: string, token: string): Promise<SuggestMetadataSuggestionsResponse> {
  const params = new URLSearchParams({ limit: '10' })
  const normalizedKeyword = keyword.trim()
  if (normalizedKeyword !== '') {
    params.set('keyword', normalizedKeyword)
  }
  return apiJson<SuggestMetadataSuggestionsResponse>(`/songs/suggest/suggestions?${params.toString()}`, {}, token)
}

export const suggestService: SuggestService = {
  search,
  identify,
  download,
  enhance,
  metadataSuggestions,
}

export const suggestSearch = search
export const suggestIdentify = identify
export const suggestDownload = download
export const suggestEnhance = enhance
export const suggestMetadataSuggestions = metadataSuggestions
