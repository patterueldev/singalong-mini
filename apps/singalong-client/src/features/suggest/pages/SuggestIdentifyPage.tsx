import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSuggestService } from '../hooks/useSuggestService'
import { buildInitialSuggestDraft, parseYouTubeVideoId } from '../../../shared/lib/suggest'
import type { SuggestDraft } from '../../../shared/types/client'
import { BlockingHud } from '../components/BlockingHud'

type SuggestIdentifyPageProps = {
  nickname: string
  authToken: string
  onIdentify: (draft: SuggestDraft) => void
  onCancel: () => void
  onChangeNickname: () => void
}

export function SuggestIdentifyPage({
  nickname,
  authToken,
  onIdentify,
  onCancel,
  onChangeNickname,
}: SuggestIdentifyPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { identify: suggestIdentify } = useSuggestService()
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
