# Backend JWT auth

## Auth model
- Login issues a JWT bearer token.
- Token payload includes the user id, username, role, and expiration.
- The backend validates the token with the configured JWT secret and algorithm.

## Protected routes
- Session APIs are bearer-protected and require an admin user:
  - `GET /api/sessions`
  - `POST /api/sessions`
  - `PATCH /api/sessions/{session_id}/archive`
- `GET /api/users/me` returns the current authenticated user.

## Environment variables
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`

## Notes
- JWT logout is client-side state clearing only; the token is not revoked server-side yet.
- Keep user and session routes separate from auth helpers to preserve the service/router split.
