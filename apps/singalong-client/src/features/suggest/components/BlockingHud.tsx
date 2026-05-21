export function BlockingHud({ message }: { message: string }) {
  return (
    <div className="blocking-hud" role="status" aria-live="polite" aria-busy="true">
      <div className="blocking-hud-card">
        <div className="blocking-hud-spinner" />
        <p>{message}</p>
      </div>
    </div>
  )
}
