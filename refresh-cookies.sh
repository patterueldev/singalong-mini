#!/usr/bin/env bash
# Refresh yt-dlp cookies from local browser into ./data/cookies.txt by default.
#
# Usage:
#   ./refresh-cookies.sh [VIDEO_ID]
#
# Optional env:
#   BROWSER=firefox|chrome|safari
#   YTDLP_COOKIES_PATH=/absolute/or/relative/path/to/cookies.txt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO_ID="${1:-eQVLPTTD51k}"
BROWSER="${BROWSER:-firefox}"
COOKIES_DEST="${YTDLP_COOKIES_PATH:-$SCRIPT_DIR/data/singalong-backend/cookies.txt}"

echo "=== py-service yt-dlp cookie refresh ==="
echo "Browser : $BROWSER"
echo "Video ID: $VIDEO_ID"
echo "Output  : $COOKIES_DEST"
echo

mkdir -p "$(dirname "$COOKIES_DEST")"

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "ERROR: yt-dlp not found in PATH. Install it first (e.g. brew install yt-dlp)."
  exit 1
fi

echo "Exporting cookies from $BROWSER..."
yt-dlp \
  --cookies-from-browser "$BROWSER" \
  --cookies "$COOKIES_DEST" \
  --skip-download \
  --quiet \
  "https://www.youtube.com/watch?v=$VIDEO_ID"

if [[ ! -f "$COOKIES_DEST" ]]; then
  echo "ERROR: cookies file was not created. Check that $BROWSER has YouTube cookies."
  exit 1
fi

echo "✓ Cookies written to: $COOKIES_DEST"
echo "py-service will use this file on next request (container restart not required)."
