# singalong-admin agent guide

Use the admin app as a route-driven React UI under `/admin/`.

## Auth contract
- Login stores a JWT bearer token in `localStorage`.
- Restore auth on reload by validating the stored token with `GET /api/users/me`.
- All session requests must send `Authorization: Bearer <token>`.

## Routing contract
- `/login` is the public entry point when logged out.
- `/sessions` is the authenticated working area.
- Root and unknown paths should redirect based on auth state.
- Backend must serve SPA fallback for `/admin/*` deep links and only return 404 for missing static assets.

## References
- `docs/admin-auth-routing.md`
- `docs/backend-jwt-auth.md`
