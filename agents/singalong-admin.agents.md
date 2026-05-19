# singalong-admin agent guide

Use the admin app as a route-driven React UI under `/admin/`.

## Auth contract
- Login stores a JWT bearer token in `localStorage`.
- Restore auth on reload by validating the stored token with `GET /api/users/me`.
- All session requests must send `Authorization: Bearer <token>`.

## Routing contract
- `/login` is the public entry point when logged out.
- `/sessions` is the authenticated working area.
- `/sessions/:sessionCode` is the authenticated session control workspace.
- Root and unknown paths should redirect based on auth state.
- Backend must serve SPA fallback for `/admin/*` deep links and only return 404 for missing static assets.

## Session control contract
- Session list rows should route active sessions to `/sessions/:sessionCode`.
- Session control page is a two-panel layout:
  - Left: playback controls/status.
  - Right: queued songs + Songbook action.
- Use `/ws/admin?session_code=<code>&token=<jwt>` for realtime session control updates.
- Keep queue/download payloads mocked until songs/download workflows are implemented.

## References
- `docs/admin-auth-routing.md`
- `docs/backend-jwt-auth.md`
