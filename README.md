# Singalong Mini

I want this to be a very simple and straightforward implementation of the Singalong Karaoke system. Applications would be:
- Python Server - Handles sessions, songbook, reservations, and downloads.
- Player MacOS App - Handles Playback
- Unified Client Web App - One frontend with route-based surfaces:
  - `/client/admin` - Managing sessions, reservations, and playback controls
  - `/client/guest` - Guest-facing songbook/reservation UI (planned)
  - `/client/suggest` - Song suggestion UI (planned)

Unlike the original Singalong Karaoke system, I want this to be less restrictive, assume a one-off application (but still reusable if data is kept intact).

# Compose workflows
- Development stack: `infrastructure/development/docker-compose.yml`
  - Run with: `docker compose -f infrastructure/development/docker-compose.yml up --build`
- Production stack (single app container + db): root `docker-compose.yml`
  - Run with: `docker compose up --build`
- Backend data mount contract: `./data/singalong-backend:/data`
  - Media root in container: `/data/media`
  - Cookies file used by song download: `/data/cookies.txt`

# Proposed Database Schema
- Sessions
  - id (primary key)
  - session_code (6-digit code for players to join)
  - name
  - created_at
  - updated_at
  - archived_at (nullable; if not null, session is considered archived and won't be joined by new Player Apps)
- Songs
  - id (primary key)
  - title
  - artist
  - duration (in seconds)
  - language (optional; ISO 639-1 code, e.g., 'en' for English, 'zh' for Chinese, 'jp' for Japanese, etc.)
  - is_off_vocal (boolean; indicates if the song is an instrumental version without vocals)
  - has_lyrics (boolean; indicates if the song has lyrics embedded in the video)
  - video_file (filename of the downloaded video in `/data/media/songs/` e.g. `never_gonna_give_you_up[abc123].mp4`)
  - thumbnail_file (optional; filename of the thumbnail image in `/data/media/thumbnails/` e.g. `never_gonna_give_you_up[abc123].jpg`)
  - lyrics (optional; plain text)
  - metadata: <String: String> (optional; a JSON string for any additional metadata that may be useful, such as original YouTube title, description, etc.)
  - source (e.g., 'youtube', 'local', etc.)
  - source_id (optional; an identifier from the source platform, e.g., YouTube video ID)
  - source_url (optional; original URL where the song was downloaded from, for reference)
  - added_by (required; id of the user who suggested or added the song)
  - added_in_session (nullable; session if not null, indicates the session ID in which the song was added, for tracking purposes)
  - last_modified_by (nullable; id of the user who last modified the song details, for tracking purposes)
  - created_at
  - updated_at
  - archived_at (nullable; if not null, song is considered archived and won't be shown in the songbook for new reservations)
- Reservations
  - id (primary key)
  - session_id (foreign key to Sessions)
  - song_id (foreign key to Songs)
  - order (integer to determine the position in the queue)
  - status (e.g., `pending`, `finished`, `skipped`)
  - reserved_by (name or identifier of the person who made the reservation)
  - reserved_at (timestamp of when the reservation was made)
- Users
  - id (primary key)
  - username (serves as unique identifier and nickname for the user)
  - password_hash (nullable; not required for guests)
  - role (e.g., 'admin', 'guest', 'player'; determines permissions and access levels)
  - created_at
  - updated_at

# Proposed API Endpoints
## Sessions
- GET /api/sessions/active - Get the latest active session (for Player App to join)
- POST /api/sessions - Create a new session (Admin Web App)
- GET /api/sessions/{session_id}/queue - Get the current queue of songs for a session (Player App)
- POST /api/sessions/{session_id}/queue - Add a new song to the session's queue (Admin Web App / Guest Web App)

## User
- POST /api/users/login - Authenticate a user (Admin Web App)
- POST /api/users/logout - Log out a user (Admin Web App)
- POST /api/users/guest - (Unstrictly) Create a guest user with a nickname (Guest Web App)
- GET /api/users/guest/username - returns a suggested guest username based on the nickname provided (Guest Web App)

## Songs
- GET /api/songs - Get the list of all songs in the songbook (Admin Web App / Guest Web App)
- GET /api/songs/search?q={query} - Search for songs in the songbook based on a query (Admin Web App / Guest Web App)
- POST /api/songs/suggest/search - Search for a song on supported platforms (e.g., YouTube) based on a query (Admin Web App, Guest Web App, Songs Suggestion Web App)
- POST /api/songs/suggest/identify - Accepts a URL and identifies the song details (Admin Web App, Guest Web App, Songs Suggestion Web App)
- POST /api/songs/suggest/enhance - Accepts song details json and enhances it using OpenAI API (Admin Web App, Guest Web App, Songs Suggestion Web App)
- POST /api/songs/suggest/download - Accepts a YouTube URL and queues an async download via `yt-dlp` (HTTP 202 Accepted, includes `youtube_id`; uses `/data/cookies.txt` when present)
- GET /media/{path} - Serve media file for playback from `/data/media` (Player App)
  - Allowed prefixes only: `assets/*` and `songs/*`
  - Example: `GET /media/assets/loop.mp4`
  - Example: `GET /media/songs/<filename>`
- Downloaded songs filename convention:
  - `<normalized_title>[<youtube_id>].<ext>`
  - `youtube_id` allows letters, numbers, `_`, and `-`
# Flows

## Player Flow
1. Player App starts up and connects to the server. Only connects with localhost, so it must be on the same machine as the server.
2. Player App initially asks the server for the latest active session and will join it. If there's none, it will keep asking until one is detected. (Therefore, the initial request is basically a polling request)
3. Once the Player App joins a session, Player first retrieves the queue of unplayed songs, then listen to websockets for updates and commands. Real-time updates may include:
- Queue Modifications (new songs added, songs removed, songs moved around)
- Playback Commands (play, pause, stop, skip, etc.)
4. Player App will also send back updates to the server regarding the duration of the currently playing song, so the server can keep track of the progress and send to the Admin Web App.
5. IF there's a new session, the Player App will have to be restarted to connect to the new session. This is a limitation of the current design, but it keeps things simple. Future iterations may include a more dynamic session management system where the Player App can seamlessly switch between sessions without needing a restart.

## Admin Web App Flow
1. Admin logs in to the Admin Web App (authentication can be simple, or even just a password prompt for simplicity).
2. Admin can create a new session, which will automatically be detected by the Player App and joined.
3. Admin can view the songbook, which is a list of all available songs that can be added to the session's queue.
4. Admin can request song downloads from YouTube. The server accepts the request immediately (`202`) and processes the download asynchronously.
