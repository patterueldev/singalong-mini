# Singalong Mini — Project Overview

## What It Is

A karaoke management system: a Python backend and a React web client that serves all surfaces — admin, guest, songbook, and a fullscreen web player for wall/TV display. There is also a macOS SwiftUI player app as an alternative. Designed for one-off karaoke sessions, similar to event-based systems. The admin creates a session, guests join via a 6-digit code, songs are reserved into a queue, and the web player handles fullscreen playback controlled by the admin via WebSocket commands.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  singalong-client (React SPA)                            │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────┐ │
│  │ /admin/* │ │ /guest/* │ │ /songbook/* │ │ /player  │ │
│  │ sessions │ │ join/    │ │ public      │ │ fullscreen│ │
│  │ queue    │ │ queue/   │ │ browser +   │ │ karaoke   │ │
│  │ songbook │ │ suggest  │ │ suggest     │ │ playback  │ │
│  └────┬─────┘ └────┬─────┘ └──────┬──────┘ └────┬─────┘ │
└───────┼────────────┼──────────────┼──────────────┼───────┘
        │ REST + WS  │ REST + WS    │ REST         │ REST + WS
  ┌─────┴────────────┴──────────────┴──────────────┴───────┐
  │  singalong-backend (FastAPI + Uvicorn)                  │
  │  ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │
  │  │ REST API │ │WebSocket │ │ Song Downloader         │  │
  │  │ routers/ │ │ Hub      │ │ (yt-dlp + FFmpeg)       │  │
  │  │ sessions │ │ player/  │ │ AI Enhancement          │  │
  │  │ songs    │ │ admin/   │ │ (OpenAI agents)         │  │
  │  │ users    │ │ guest    │ │ Thumbnails / Trim       │  │
  │  │ media    │ │ channels │ │                         │  │
  │  └────┬─────┘ └──────────┘ └────────────────────────┘  │
  └───────┼────────────────────────────────────────────────┘
          │
  ┌───────┴───────┐
  │ PostgreSQL 16 │
  └───────────────┘

  ┌──────────────────────────────────────────┐
  │  singalong-player (macOS SwiftUI alt)    │
  │  Same protocol: polls active session     │
  │  → connects /ws/player → admin-driven    │
  └──────────────────────────────────────────┘
```

## Project Structure

```
singalong-v2/
├── apps/
│   ├── singalong-backend/     # Python/FastAPI server
│   │   ├── app/
│   │   │   ├── main.py        # App entry, WebSocket routes, startup
│   │   │   ├── config.py      # Pydantic-settings config
│   │   │   ├── models.py      # SQLAlchemy ORM models (8 tables)
│   │   │   ├── schemas.py     # Pydantic request/response schemas
│   │   │   ├── db.py          # DB engine & session factory
│   │   │   ├── security.py    # JWT encode/decode
│   │   │   ├── bootstrap.py   # Seed admin user on startup
│   │   │   ├── routers/       # 4 router files
│   │   │   │   ├── sessions.py
│   │   │   │   ├── songs.py
│   │   │   │   ├── users.py
│   │   │   │   └── media.py
│   │   │   ├── services/      # Business logic layer
│   │   │   │   ├── ws.py              # WebSocket hub (440 lines)
│   │   │   │   ├── sessions.py        # Session CRUD
│   │   │   │   ├── session_queue.py   # Queue operations
│   │   │   │   ├── auth.py            # JWT + password verification
│   │   │   │   ├── song_downloader_service.py  # Async downloader (669 lines)
│   │   │   │   ├── download_queue.py  # Download item listing
│   │   │   │   ├── progress_tracker.py
│   │   │   │   ├── research_tools.py
│   │   │   │   ├── song_quality.py    # Quality scoring
│   │   │   │   ├── songs_download.py
│   │   │   │   ├── thumbnail_service.py
│   │   │   │   ├── ytdlp/             # yt-dlp wrappers
│   │   │   │   └── songs/             # Song operations
│   │   │   ├── agents/        # OpenAI-based AI agents
│   │   │   └── tasks/         # Background tasks (trim cleanup)
│   │   └── requirements.txt
│   ├── singalong-client/      # React SPA (Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── app/           # AppShell, AppRoutes, AppShellContent
│   │   │   ├── features/      # Domain-based feature modules
│   │   │   │   ├── admin/     # Admin dashboard & session control
│   │   │   │   ├── guest/     # Guest join, queue, suggest
│   │   │   │   ├── player/     # Wall display player (browser-based, at /player route)
│   │   │   │   ├── songbook/  # Public songbook browser
│   │   │   │   ├── suggest/   # Song suggestion wizard
│   │   │   │   └── shared/    # Auth service, queue transforms
│   │   │   └── shared/        # API client, types, lib, storage
│   │   └── vite.config.ts
│   └── singalong-player/      # macOS SwiftUI app
│       ├── Package.swift      # Swift 6.3, macOS 14+
│       └── Sources/
│           └── SingalongPlayer/
│               ├── SingalongPlayerApp.swift
│               ├── PlayerRootView.swift     # Idle + Main screens
│               ├── PlayerViewModel.swift    # Poll/WS state machine
│               └── PlayerModels.swift
├── infrastructure/
│   ├── development/           # Dev Docker: db + backend + client (hot reload)
│   │   ├── docker-compose.yml
│   │   ├── Backend.dockerfile
│   │   ├── Client.dockerfile
│   │   └── Admin.dockerfile
│   └── production/            # Prod Docker: db + single app container
│       ├── docker-compose.yml
│       └── Singalong.dockerfile  # Builds client + backend together
├── data/                      # Docker volume mounts
│   ├── singalong-backend/     # /data mount (media, cookies.txt)
│   └── singalong-db/          # PostgreSQL data
├── docker-compose.yml         # Production compose (root level)
└── docs/                      # Existing documentation
    ├── project-overview.md    # This file
    ├── admin-auth-routing.md
    ├── backend-jwt-auth.md
    └── player-app.md
```

## Database Schema

8 tables managed via SQLAlchemy ORM with PostgreSQL:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | All users (admin, guest, player roles) | id, username, password_hash, role |
| `sessions` | Karaoke sessions | id, session_code (6-char), name, vibes, archived_at |
| `songs` | Song catalog (the "songbook") | id, title, artist, duration, video_file, status (draft/downloading/published/archived/error), trim columns |
| `song_downloads` | Active download tracking | song_id (FK), source_url, source_id, status, progress_pct |
| `song_queue` | Per-session queue/reservations | session_id (FK), song_id (FK), queue_order, status (playing/pending/finished/skipped), playback state columns |
| `song_trim_history` | Trim operation records | song_id (FK), trim_start_ms, trim_end_ms, backup_file, status |
| `song_trim_archive` | Archived versions of trimmed files | song_id (FK), version, file_path, expires_at |
| `song_duplicate_dismissals` | Remembered admin decisions on duplicate pairs | song_id_low (FK), song_id_high (FK), dismissed_by (FK), reason (dismissed/merged) |

Schema evolution happens at startup via `main.py:on_startup` — auto-adds missing columns and enum values for zero-downtime migrations.

## Running the Project

### Development
```bash
docker compose -f infrastructure/development/docker-compose.yml up --build
```
- PostgreSQL on 5432
- Backend on 8000 (hot reload via `--reload`)
- Client dev server on 5173 (Vite HMR)
- Client proxies API calls to backend

### Production
```bash
docker compose up --build
```
- Single container (`singalong-app`) serves API + pre-built client SPA
- Backend serves `/client/*` static files from the built Vite dist
- Defaults to port 9000 (configurable via `SINGALONG_HTTP_PORT`)

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | Required for AI song enhancement |
| `SINGALONG_ADMIN_USERNAME` | `admin` | Admin login |
| `SINGALONG_ADMIN_PASSWORD` | `password` | Admin password |
| `SINGALONG_JWT_SECRET_KEY` | `singalong-dev-jwt-secret…` | JWT signing key (≥32 bytes) |
| `SINGALONG_JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `43200` | Token lifetime (30 days) |
| `SINGALONG_HTTP_PORT` | `9000` | Prod HTTP port |
| `CORS_ORIGINS` | `localhost:5173` | Allowed CORS origins |

## Auth Model

- JWT-based, Bearer tokens
- Three roles: `admin`, `guest`, `player`
- Login endpoints issue tokens (`POST /api/users/login`, `POST /api/users/guest/login`)
- `GET /api/users/player-token` for the player service account
- Browser WebSocket auth passes token via `?token=` query param
- Logout is client-side only (no token revocation)
- See `docs/backend-jwt-auth.md` for details

## Real-Time: WebSocket Hub

Three WebSocket channels managed by `SessionWebSocketHub`:

| Channel | Route | Auth | Events Received | Events Sent |
|---------|-------|------|-----------------|-------------|
| **Player** | `/ws/player` | player/admin | `queue.updated`, `playback.play`, `playback.pause`, `playback.seek`, `playback.skip`, `playback.volume`, `session.ended` | `playback.position` (every 1s), `playback.ended` |
| **Admin** | `/ws/admin` | admin only | `playback.position`, `playback.ended`, `queue.updated`, `downloads.updated` | `playback.*` commands, `queue.updated` |
| **Guest** | `/ws/guest` | guest/admin | `queue.updated`, `downloads.updated`, `session.ended` | (none) |

Admin-to-player messages are forwarded through the hub. Guest channel provides read-only queue updates and download progress.

## Core Flows

### 1. Session Lifecycle
1. Admin creates session → 6-digit code generated
2. Web player (at `/player`) auto-logs in via player token, polls `GET /api/sessions/active` until session found
3. Web player connects to `/ws/player` for real-time control (play/pause/skip/seek/volume)
4. Guests join via nickname + session code → JWT issued
5. Admin archives session → `session.ended` broadcasts → player returns to idle
6. (The macOS SwiftUI player follows the same protocol: poll → connect WS → receive commands)

### 2. Song Suggestion Pipeline
```
Search (YouTube API via yt-dlp)
  → Identify (extract metadata from URL)
    → Enhance (optional, 3-phase AI via OpenAI)
      → Update (user edits metadata)
        → Download (async yt-dlp + FFmpeg)
          → Reserve (optional, add to session queue immediately)
```
All steps are individual API endpoints, allowing the wizard to be progressive (step by step) or compact.

### 3. Song Reservation & Playback
```
Guest/Admin reserves song → POST /api/sessions/{code}/queue
  → WebSocket broadcasts queue.updated to all channels
  → Admin controls playback (play/pause/skip/seek)
  → Web player at /player (or macOS player) reports position every 1s
  → Admin(s) see live position updates
```

### 4. Web Player (`/player` route)
The browser-based player is the primary wall/TV display. Features:
- Fullscreen video playback with background looping ambient video
- Auto-login via player token endpoint (no UI login needed)
- Real-time WebSocket connection to `/ws/player`
- Scrolling marquee queue showing upcoming songs
- QR code overlay for guests to scan and join
- Progress bar seek indicator (read-only), volume indicator
- Idle screen when no active session
- Transition messages with random encouragements between songs
- Auto-reconnect with exponential backoff
- Restricted to `localhost` / `.local` hostnames only (security measure)

The macOS SwiftUI app (`apps/singalong-player/`) implements the same polling + WebSocket protocol as an alternative native display.

### 5. Video Trimming
- Admin opens trim modal on any song with a video file
- Range selection via draggable timeline markers or time inputs
- Backend creates backup, re-encodes with FFmpeg
- Trim history tracked with restore capability
- Progress polling via `GET /api/songs/{id}/trim-progress/{operationId}`
- Automatic archive cleanup after 30 days

## API Surface Summary

| Router | Prefix | Endpoints | Auth |
|--------|--------|-----------|------|
| Sessions | `/api/sessions` | 12 | Mixed (public, admin, guest) |
| Songs | `/api/songs` | 19 | Mixed (public, admin, guest) |
| Users | `/api/users` | 8 | Mixed |
| Media | `/media` | 1 | Public |
| WebSocket | `/ws/*` | 3 | JWT via query param |
| **Total** | | **40 REST + 3 WS** | |

## Client Route Map

| Client Route | Feature | Auth Gate |
|--------------|---------|-----------|
| `/guest` | Join form (nickname + code) | None |
| `/guest/home` | Queue viewer, reserve, cancel | Guest JWT |
| `/guest/downloads` | Download progress monitor | Guest JWT |
| `/guest/songbook` | Songbook browser + suggest | Guest JWT |
| `/songbook` | Public songbook browser | None / weak guest |
| `/songbook/song/:id` | Song details modal | None |
| `/admin/login` | Username/password login | None |
| `/admin/dashboard` | Session list, create, archive | Admin JWT |
| `/admin/songbook` | Song management (edit, trim, archive) | Admin JWT |
| `/admin/songbook/duplicates` | Duplicate audit sweep (merge, dismiss) | Admin JWT |
| `/admin/sessions/:code` | Session control (playback, queue, songbook) | Admin JWT |
| `/player` | Fullscreen karaoke playback (web player) | localhost/.local only + auto-login player token |
| `*` | Catch-all → redirect to `/guest` | — |

## Key Dependencies

### Backend
| Package | Purpose |
|---------|---------|
| FastAPI | REST framework |
| SQLAlchemy 2.0 | ORM |
| psycopg 3 | PostgreSQL driver |
| passlib + bcrypt | Password hashing |
| PyJWT | JWT encode/decode |
| yt-dlp | YouTube song download |
| openai | AI song metadata enhancement |
| Pillow | Thumbnail processing |
| APScheduler | Trim archive cleanup scheduling |

### Client
| Package | Purpose |
|---------|---------|
| React 19 + React Router 7 | UI framework + routing |
| Vite 8 | Build tool |
| @radix-ui/react-dropdown-menu | Dropdown UI |
| qrcode | Session QR code generation |

### Player
| — | — |
|----|----|
| Swift 6.3 / SwiftUI | macOS native app (≥14.0) |
| URLSession | HTTP + WebSocket client |

## Backend Services Deep Dive

### Song Downloader (`song_downloader_service.py`)
- Single-threaded `ThreadPoolExecutor` processes one download at a time
- Downloads via `yt-dlp`, extracts audio + video tracks
- Saves to `/data/media/songs/<normalized_title>[<youtube_id>].<ext>`
- Updates `song_downloads` table with progress (progress_pct, current_step)
- Auto-reserves song in session queue if requested at download time
- Recovers pending downloads on startup
- Broadcasts `downloads.updated` via WebSocket

### AI Enhancement Agents (`agents/`)
- `OrchestratorAgent` coordinates 3 sub-agents:
  - Title Guesser (cleans up YouTube titles)
  - Web Researcher (enriches genre/tags)
  - Language Identifier (detects song language)
- Uses OpenAI API (requires `OPENAI_API_KEY`)
- Gracefully degrades on partial failure

### Thumbnail Service
- Downloads thumbnails from YouTube URLs
- Converts base64 data URLs to JPG files
- Saves to `/data/media/thumbnails/`

### Session Queue
- Manages queue ordering, status transitions
- Handles reorder, skip, finish, cancel operations
- Auto-advances to next song on finish/skip
- Broadcasts changes to all connected WebSocket clients

### Trim Archive Cleanup
- `tasks/trim_cleanup_task.py` runs via APScheduler
- Deletes expired backup files and archive records
