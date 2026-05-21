import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isValidSuggestNickname } from '../../../shared/storage/suggestStorage'

type SuggestLoginPageProps = {
  initialNickname: string
  onLogin: (nickname: string) => Promise<void>
}

export function SuggestLoginPage({ initialNickname, onLogin }: SuggestLoginPageProps) {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(initialNickname)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Suggest Song Login</h1>
        <p className="subtitle">Nickname must use letters, numbers, and underscore only.</p>
        <form
          className="form top-gap"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isValidSuggestNickname(nickname)) {
              setErrorMessage('Use only letters, numbers, or underscores.')
              return
            }
            setErrorMessage('')
            setIsSubmitting(true)
            void onLogin(nickname)
              .then(() => navigate('/songbook/suggest/search'))
              .catch((error: unknown) => {
                const message =
                  error instanceof Error ? error.message : 'Guest login failed'
                setErrorMessage(message)
              })
              .finally(() => {
                setIsSubmitting(false)
              })
          }}
        >
          <label>
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="guest_user"
              required
            />
          </label>
          {errorMessage !== '' ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  )
}
