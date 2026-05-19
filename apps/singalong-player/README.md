# Singalong Player (macOS)

## Generate Xcode project (XcodeGen)

```bash
cd apps/singalong-player
xcodegen generate
open SingalongPlayer.xcodeproj
```

## Build from terminal with Xcode

```bash
cd apps/singalong-player
xcodegen generate
xcodebuild -project SingalongPlayer.xcodeproj -scheme SingalongPlayer -destination 'platform=macOS' build
```

## Optional package-only build

If you just want a quick local compile check:

```bash
cd apps/singalong-player
swift build
```

## Backend URL override

Player bootstraps by polling `GET /api/sessions/active` every 5 seconds until a session is active.
Once active, it logs in for JWT and connects to `/ws/player`.

Default backend base URL is:
- `http://localhost:9000`

Override with:

```bash
SINGALONG_PLAYER_API_BASE_URL=http://localhost:9000
```

## Player auth for websocket

Player logs in through `POST /api/users/login` before opening the websocket.

Defaults:
- `SINGALONG_PLAYER_USERNAME=admin`
- `SINGALONG_PLAYER_PASSWORD=password`

Override with:

```bash
SINGALONG_PLAYER_USERNAME=admin
SINGALONG_PLAYER_PASSWORD=password
```
