# singalong-backend agent guide

Build and maintain the backend in `apps/singalong-backend` as a FastAPI + PostgreSQL service.

## Current scope
- Focus only on users for now.
- Keep implemented API surface limited to:
  - `POST /api/users/login`
  - `POST /api/users/logout`
  - `POST /api/users/guest`
  - `GET /api/users/guest/username`

## Expectations
- Keep the code straightforward and easy to extend.
- Persist users in PostgreSQL (no in-memory-only substitutes).
- Prefer explicit request/response schemas and clear validation.
- Ensure dockerized local development stays aligned with `docker-compose.yml` and `infrastructure/development/Backend.dockerfile`.
