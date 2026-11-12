#!/usr/bin/env bash
# Builds the web app and publishes it to Convex storage, served at <site>/studio and <site>/assets/*.
# Needs a linked Convex deployment (.env.local from `npx convex dev`).
set -euo pipefail
cd "$(dirname "$0")/.."

convex_url=$(grep -E '^VITE_CONVEX_URL=' .env.local | cut -d= -f2-)
site_url=$(grep -E '^VITE_CONVEX_SITE_URL=' .env.local | cut -d= -f2-)
[ -n "$convex_url" ] || { echo "VITE_CONVEX_URL missing in .env.local" >&2; exit 1; }

rm -rf dist
VITE_CONVEX_URL="$convex_url" npm run build >/dev/null

content_type() {
  case "$1" in
    *.html) echo "text/html; charset=utf-8" ;;
    *.js | *.mjs) echo "text/javascript; charset=utf-8" ;;
    *.css) echo "text/css; charset=utf-8" ;;
    *.wasm) echo "application/wasm" ;;
    *.svg) echo "image/svg+xml" ;;
    *.png) echo "image/png" ;;
    *.ico) echo "image/x-icon" ;;
    *) echo "application/octet-stream" ;;
  esac
}

run() { npx convex run "$@" 2>/dev/null | { grep -v -e UNDICI -e trace-warnings || true; }; }

# Assets first, the page last: the new page only goes live once everything it references is there.
files=$(cd dist && find . -type f ! -name index.html | sed 's#^\./##' | sort; echo index.html)
for path in $files; do
  ct=$(content_type "$path")
  upload=$(run site:uploadUrl | tr -d '"')
  storage_id=$(curl -sS -X POST -H "Content-Type: $ct" --data-binary "@dist/$path" "$upload" | jq -r .storageId)
  [ "$storage_id" != "null" ] || { echo "upload failed: $path" >&2; exit 1; }
  run site:register "$(jq -nc --arg p "$path" --arg s "$storage_id" --arg c "$ct" '{path:$p, storageId:$s, contentType:$c}')" >/dev/null
  echo "published $path"
done
echo "Studio: ${site_url}/studio"
