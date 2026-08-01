import { useCallback, useEffect, useRef, useState } from 'react'
import { useSuggestService } from './useSuggestService'
import {
  buildInitialSuggestDraft,
  mapSuggestSearchItem,
  normalizeSuggestQuery,
  parseYouTubeVideoId,
} from '../../../shared/lib/suggest'
import type { SuggestDraft, SuggestResult } from '../../../shared/types/client'

export type UseSuggestSearchFlowOptions = {
  authToken: string
  initialQuery?: string
  onIdentified: (draft: SuggestDraft) => void
}

export function useSuggestSearchFlow({ authToken, initialQuery = '', onIdentified }: UseSuggestSearchFlowOptions) {
  const { search: suggestSearch, identify: suggestIdentify } = useSuggestService()
  const [query, setQuery] = useState(() => initialQuery.trim())
  const [effectiveQuery, setEffectiveQuery] = useState('')
  const [queryInfo, setQueryInfo] = useState('')
  const [results, setResults] = useState<SuggestResult[]>([])
  const [pendingIdentifyResult, setPendingIdentifyResult] = useState<SuggestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isIdentifyingUrl, setIsIdentifyingUrl] = useState(false)
  const isYouTubeUrlQuery = parseYouTubeVideoId(query) !== null
  // Only one search should ever be in flight: each new call aborts whatever the previous one
  // started, so a fast typist never has a slow, stale response overwrite fresher results — and
  // the backend stops doing work nobody's waiting on anymore (see issue #60).
  const searchAbortControllerRef = useRef<AbortController | null>(null)

  const executeSearch = useCallback(
    (searchQuery: string) => {
      searchAbortControllerRef.current?.abort()

      const normalized = normalizeSuggestQuery(searchQuery)
      if (normalized.effectiveQuery === '') {
        searchAbortControllerRef.current = null
        setQueryInfo('Please enter a search query.')
        setResults([])
        setEffectiveQuery('')
        return
      }

      const controller = new AbortController()
      searchAbortControllerRef.current = controller

      setErrorMessage('')
      setIsSearching(true)

      void suggestSearch(normalized.effectiveQuery, authToken, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return
          setEffectiveQuery(response.effective_query)
          setQueryInfo(response.appended_karaoke ? 'Backend appended "karaoke" to the query.' : '')
          setResults(response.results.map(mapSuggestSearchItem))
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Search failed'
          setErrorMessage(message)
          setEffectiveQuery(normalized.effectiveQuery)
          setQueryInfo('')
          setResults([])
        })
        .finally(() => {
          if (controller.signal.aborted) return
          setIsSearching(false)
        })
    },
    [authToken, suggestSearch],
  )

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === '') {
      searchAbortControllerRef.current?.abort()
      setResults([])
      setEffectiveQuery('')
      setQueryInfo('')
      setErrorMessage('')
      return
    }

    if (parseYouTubeVideoId(trimmed) !== null) {
      searchAbortControllerRef.current?.abort()
      setResults([])
      setEffectiveQuery('')
      setQueryInfo('')
      setErrorMessage('')
      return
    }

    const timeoutId = window.setTimeout(() => {
      executeSearch(trimmed)
    }, 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [executeSearch, query])

  // Abort any in-flight search when the component unmounts.
  useEffect(() => {
    return () => {
      searchAbortControllerRef.current?.abort()
    }
  }, [])

  const identifySourceUrl = useCallback(
    (sourceUrl: string) => {
      setErrorMessage('')
      setIsIdentifyingUrl(true)
      return suggestIdentify(sourceUrl, authToken)
        .then((response) => {
          onIdentified(buildInitialSuggestDraft(response))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Identify failed'
          setErrorMessage(message)
        })
        .finally(() => {
          setIsIdentifyingUrl(false)
        })
    },
    [authToken, onIdentified, suggestIdentify],
  )

  const requestIdentify = useCallback(
    (result: SuggestResult) => {
      if (result.existsInSongbook === true) {
        setPendingIdentifyResult(result)
        return
      }
      void identifySourceUrl(result.sourceUrl)
    },
    [identifySourceUrl],
  )

  const confirmPendingIdentify = useCallback(() => {
    if (pendingIdentifyResult === null) {
      return
    }
    void identifySourceUrl(pendingIdentifyResult.sourceUrl)
    setPendingIdentifyResult(null)
  }, [identifySourceUrl, pendingIdentifyResult])

  const clearPendingIdentifyResult = useCallback(() => {
    setPendingIdentifyResult(null)
  }, [])

  const handleIdentifyUrl = useCallback(() => {
    const normalizedUrl = query.trim()
    const videoId = parseYouTubeVideoId(normalizedUrl)
    if (videoId === null) {
      setErrorMessage('Enter a valid YouTube URL.')
      return
    }
    void identifySourceUrl(normalizedUrl)
  }, [identifySourceUrl, query])

  return {
    query,
    setQuery,
    effectiveQuery,
    queryInfo,
    results,
    errorMessage,
    isSearching,
    isIdentifyingUrl,
    isYouTubeUrlQuery,
    pendingIdentifyResult,
    clearPendingIdentifyResult,
    executeSearch,
    requestIdentify,
    confirmPendingIdentify,
    handleIdentifyUrl,
    identifySourceUrl,
  }
}
