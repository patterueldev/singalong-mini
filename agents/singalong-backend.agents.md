# singalong-backend agent guide

Build and maintain the backend in `apps/singalong-backend` as a FastAPI + PostgreSQL service.

## Current scope
- Keep auth/session/media contracts aligned with the current backend implementation.
- Key API routes to preserve:
  - `POST /api/users/login`
  - `POST /api/users/logout`
  - `POST /api/users/guest`
  - `GET /api/users/guest/username`
  - `POST /api/songs/suggest/download` (async trigger, returns 202 with `youtube_id`)
  - `GET /media/{path}` (serve only `assets/*` and `songs/*`)

## Expectations
- Keep the code straightforward and easy to extend.
- Persist users in PostgreSQL (no in-memory-only substitutes).
- Prefer explicit request/response schemas and clear validation.
- Ensure dockerized local development stays aligned with `infrastructure/development/docker-compose.yml` and `infrastructure/development/Backend.dockerfile`.
- Ensure production container behavior stays aligned with root `docker-compose.yml`.
- Keep backend data contract stable: `./data/singalong-backend:/data`, media at `/data/media`, cookies at `/data/cookies.txt`.
- Preserve song filename convention for downloaded media: `<normalized_title>[<youtube_id>].<ext>` where `youtube_id` can include `_` and `-`.
