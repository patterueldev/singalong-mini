import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { isValidNickname, isValidSessionCode } from '../../../shared/lib/validation'
import { useGuestSession } from '../hooks/useGuestSession'
import { guestCheckSessionExists } from '../services/guestService'

export function GuestPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { guestAuth, sessionCode, joinGuestSession, hasGuestSession } = useGuestSession()
  const querySessionCode = useMemo(
    () => searchParams.get('sessionCode') ?? searchParams.get('sessionId') ?? '',
    [searchParams],
  )
  const [nickname, setNickname] = useState(guestAuth?.nickname ?? '')
  const [nextSessionCode, setNextSessionCode] = useState(querySessionCode || sessionCode)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (guestAuth !== null) {
      setNickname(guestAuth.nickname)
    }
  }, [guestAuth])

  useEffect(() => {
    if (querySessionCode !== '') {
      setNextSessionCode(querySessionCode)
      return
    }
    if (sessionCode !== '') {
      setNextSessionCode(sessionCode)
    }
  }, [querySessionCode, sessionCode])

  useEffect(() => {
    if (hasGuestSession && (querySessionCode === '' || querySessionCode === sessionCode)) {
      navigate('/home', { replace: true })
    }
  }, [hasGuestSession, navigate, querySessionCode, sessionCode])

  if (hasGuestSession && (querySessionCode === '' || querySessionCode === sessionCode)) {
    return <Navigate to="/home" replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')

    const cleanedNickname = nickname.trim()
    const cleanedSessionCode = nextSessionCode.trim()
    if (!isValidNickname(cleanedNickname)) {
      setErrorMessage('Nickname must use letters, numbers, or underscore.')
      return
    }
    if (!isValidSessionCode(cleanedSessionCode)) {
      setErrorMessage('Session code must be a 6-digit code.')
      return
    }

    setIsSubmitting(true)
    try {
      const exists = await guestCheckSessionExists(cleanedSessionCode)
      if (!exists) {
        setErrorMessage('Session code not found. Please check and try again.')
        return
      }
      await joinGuestSession(cleanedNickname, cleanedSessionCode)
      navigate('/home', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to join session')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="app-shell guest-fullscreen-shell">
      <section className="card auth-card guest-fullscreen-card">
        <h1>Join the party</h1>
        <p className="subtitle">Enter your nickname and session code to continue.</p>
        <form className="form top-gap" onSubmit={handleSubmit}>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Nickname (e.g. johnny_joestar)"
            autoComplete="nickname"
          />
          <input
            value={nextSessionCode}
            onChange={(event) => setNextSessionCode(event.target.value.trim())}
            placeholder="Session code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
          />
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
          <div className="row-actions top-gap">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
