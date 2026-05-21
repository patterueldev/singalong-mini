import { useNavigate } from 'react-router-dom'

export function GuestPage() {
  const navigate = useNavigate()

  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Singalong Guest</h1>
        <p className="subtitle">
          Welcome! Browse the songbook first, then suggest songs that are not yet listed.
        </p>
        <div className="row-actions top-gap">
          <button type="button" onClick={() => navigate('/songbook')}>
            Open Songbook
          </button>
          <button type="button" className="secondary" onClick={() => navigate('/admin/login')}>
            Admin Login
          </button>
        </div>
      </section>
    </main>
  )
}
