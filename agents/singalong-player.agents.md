# singalong-player agent guide

Build `apps/singalong-player` as a macOS SwiftUI app with a passive playback surface.

## Current behavior contract
- Exactly two views: **Idle** and **Main**.
- On app startup, poll `GET /api/sessions/active` every 5 seconds.
- Stay on Idle while there is no active session.
- Move to Main when an active session is returned.

## UI constraints
- Do not add routine action buttons.
- Only add fallback/retry controls if absolutely necessary for reliability.

## References
- `docs/player-app.md`
