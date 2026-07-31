import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useSuggestService } from './useSuggestService'
import { readFileAsDataUrl } from '../../../shared/lib/files'
import { normalizeTagList, splitChipInput } from '../../../shared/lib/suggest'
import type { SuggestDraft, SuggestMetadataSuggestionsResponse } from '../../../shared/types/client'

export type UseSuggestUpdateFlowOptions = {
  draft: SuggestDraft
  authToken: string
  onDraftChange: (draft: SuggestDraft) => void
  onError: (message: string) => void
}

export function useSuggestUpdateFlow({ draft, authToken, onDraftChange, onError }: UseSuggestUpdateFlowOptions) {
  const { enhance: suggestEnhance, metadataSuggestions: suggestMetadataSuggestions } = useSuggestService()
  const [originalDraft] = useState(draft)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceMessage, setEnhanceMessage] = useState('')
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [contentWarningState, setContentWarningState] = useState(() => ({
    sourceId: draft.source_id,
    dismissed: false,
  }))
  if (contentWarningState.sourceId !== draft.source_id) {
    setContentWarningState({ sourceId: draft.source_id, dismissed: false })
  }
  const isContentWarningDismissed = contentWarningState.dismissed
  const [duplicateWarningState, setDuplicateWarningState] = useState(() => ({
    sourceId: draft.source_id,
    dismissed: false,
  }))
  if (duplicateWarningState.sourceId !== draft.source_id) {
    setDuplicateWarningState({ sourceId: draft.source_id, dismissed: false })
  }
  const isDuplicateWarningDismissed = duplicateWarningState.dismissed
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

  const openThumbnailContextMenu = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.top + rect.height })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

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
  }, [authToken, suggestMetadataSuggestions])

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
  }, [authToken, genreInput, suggestMetadataSuggestions])

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
  }, [authToken, tagInput, suggestMetadataSuggestions])

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
        onError(error instanceof Error ? error.message : 'Unable to load image file')
      } finally {
        event.currentTarget.value = ''
        setContextMenu(null)
      }
    },
    [onError, updateDraft],
  )

  const resetThumbnail = useCallback(() => {
    updateDraft({
      source_thumbnail_data_url: originalDraft.source_thumbnail_data_url,
      source_thumbnail: originalDraft.source_thumbnail,
    })
    setContextMenu(null)
  }, [originalDraft, updateDraft])

  const openLyricsSearch = useCallback(() => {
    const search = `${draft.title.trim()} lyrics`.trim()
    window.open(`https://www.google.com/search?q=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer')
  }, [draft.title])

  const previewOnYoutube = useCallback(() => {
    window.open(draft.source_url, '_blank', 'noopener,noreferrer')
  }, [draft.source_url])

  const dismissContentWarning = useCallback(() => {
    setContentWarningState((current) => ({ ...current, dismissed: true }))
  }, [])

  const dismissDuplicateWarning = useCallback(() => {
    setDuplicateWarningState((current) => ({ ...current, dismissed: true }))
  }, [])

  const handleEnhance = useCallback(async () => {
    setIsEnhancing(true)
    setEnhanceMessage('')
    try {
      const response = await suggestEnhance(draft, authToken)
      if (response.status === 'success' || response.status === 'degraded') {
        const enhanced = response.enhanced
        updateDraft({
          title: enhanced.title,
          artist: enhanced.artist,
          language: enhanced.language || '',
          is_off_vocal: enhanced.is_off_vocal,
          video_has_lyrics: enhanced.video_has_lyrics,
          genre: enhanced.genre || '',
          tags: enhanced.tags || [],
          lyrics: enhanced.lyrics || '',
          isEnhanced: true,
          isLikelySong: enhanced.is_likely_song,
          contentConfidence: enhanced.content_confidence,
          contentNotice: enhanced.content_notice,
          possibleDuplicates: enhanced.duplicate_matches,
        })
        setContentWarningState((current) => ({ ...current, dismissed: false }))
        setDuplicateWarningState((current) => ({ ...current, dismissed: false }))
        setIsDetailsOpen(true)
        setEnhanceMessage(response.status === 'degraded' ? '✓ Enhanced (partial)' : '✓ Enhanced successfully!')
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
  }, [authToken, draft, suggestEnhance, updateDraft])

  return {
    previewUrl,
    updateDraft,
    genreInput,
    setGenreInput,
    tagInput,
    setTagInput,
    commitTags,
    metadataSuggestions,
    contextMenu,
    openThumbnailContextMenu,
    closeContextMenu,
    thumbnailFileInputRef,
    handleThumbnailUpload,
    resetThumbnail,
    isContentWarningDismissed,
    dismissContentWarning,
    isDuplicateWarningDismissed,
    dismissDuplicateWarning,
    isEnhancing,
    enhanceMessage,
    handleEnhance,
    isDetailsOpen,
    setIsDetailsOpen,
    openLyricsSearch,
    previewOnYoutube,
  }
}
