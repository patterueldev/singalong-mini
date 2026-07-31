import { useCallback, useEffect, useState } from 'react'
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

  const executeSearch = useCallback(
    (searchQuery: string) => {
      const normalized = normalizeSuggestQuery(searchQuery)
      if (normalized.effectiveQuery === '') {
        setQueryInfo('Please enter a search query.')
        setResults([])
        setEffectiveQuery('')
        return
      }

      setErrorMessage('')
      setIsSearching(true)

      void suggestSearch(normalized.effectiveQuery, authToken)
        .then((response) => {
          setEffectiveQuery(response.effective_query)
          setQueryInfo(response.appended_karaoke ? 'Backend appended "karaoke" to the query.' : '')
          setResults(response.results.map(mapSuggestSearchItem))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Search failed'
          setErrorMessage(message)
          setEffectiveQuery(normalized.effectiveQuery)
          setQueryInfo('')
          setResults([])
        })
        .finally(() => {
          setIsSearching(false)
        })
    },
    [authToken, suggestSearch],
  )

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === '') {
      setResults([])
      setEffectiveQuery('')
      setQueryInfo('')
      setErrorMessage('')
      return
    }

    if (parseYouTubeVideoId(trimmed) !== null) {
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
