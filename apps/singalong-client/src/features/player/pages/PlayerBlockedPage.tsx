export function PlayerBlockedPage() {
  return (
    <main className="app-shell">
      <section className="card auth-card">
        <h1>Player Unavailable</h1>
        <p className="subtitle">
          The player route is only available on localhost or local-network hosts ending in <code>.local</code>.
        </p>
      </section>
    </main>
  )
}
