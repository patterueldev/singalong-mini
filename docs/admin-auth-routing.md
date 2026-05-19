# Admin auth and routing

## Routes
- `/login` shows the admin login form.
- `/sessions` shows the authenticated session management screen.
- `/sessions/:sessionCode` shows the session control screen for a specific active session.
- `*` redirects to `/login` when logged out and `/sessions` when authenticated.
- The production app is served under `/admin/`, so the router must use the Vite base path.

## Auth storage
- JWT access tokens are stored in `localStorage`.
- Stored auth includes the token and the user profile.
- On app start, the client restores auth from storage and validates it with `GET /api/users/me`.

## API usage
- Login: `POST /api/users/login`
- Logout: `POST /api/users/logout`
- Validate auth: `GET /api/users/me`
- Session calls: `GET /api/sessions`, `POST /api/sessions`, `PATCH /api/sessions/{id}/archive`
- All session calls must send `Authorization: Bearer <token>`.
- Session control WS channel:
  - `/ws/admin?session_code=<6-digit>&token=<jwt>`
  - Receives: `playback.position`, `playback.ended`, `queue.updated`, `downloads.updated` (placeholder)
  - Sends: `playback.play`, `playback.pause`, `playback.skip`, `playback.seek`, `queue.updated`

## Notes for future work
- Keep session views route-driven.
- Do not reintroduce a second `/api` prefix in the client API base.
- For SPA deep links under a subpath (`/admin/*`), backend must serve `index.html` for non-asset routes and only return 404 for missing static assets (e.g. `.js`, `.css`, images).
- Reuse the same backend fallback pattern when adding future frontend mounts (such as `/guest/*` or `/suggest/*`).
- Keep the session control page split into two panels (left playback, right queue/songbook) for landscape-first operator workflows.
