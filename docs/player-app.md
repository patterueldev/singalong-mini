# Singalong Player (macOS)

## Scope
- Two-screen app only:
  - **Idle Screen**
  - **Main Screen**
- No direct playback controls in player UI for normal flow.
- Player behavior is backend/admin-driven.

## Startup and polling
- On launch, player polls `GET /api/sessions/active`.
- Polling interval: **5 seconds**.
- If no active session exists (404), remain on Idle and keep polling forever.
- If active session exists, transition to Main and connect to `/ws/player`.
- While WS is connected, player stops steady REST polling and listens for realtime commands.
- If WS disconnects, player falls back to the startup polling loop.

## Backend contract
- Endpoint: `GET /api/sessions/active`
- Success: returns latest active session object.
- Empty state: 404 with `No active session`.
- WebSocket channel: `/ws/player?session_code=<6-digit>&token=<jwt>`
  - Receives: `queue.updated`, `playback.play`, `playback.pause`, `playback.skip`, `playback.seek`, `session.ended`
  - Sends: `playback.position`, `playback.ended` (placeholder telemetry/events for now)

## Configuration
- `SINGALONG_PLAYER_API_BASE_URL` can override backend base URL.
- `SINGALONG_PLAYER_USERNAME` and `SINGALONG_PLAYER_PASSWORD` are used for JWT login before WS connect.
- Default base URL: `http://localhost:9000`.
- Default credentials: `admin` / `password`.
