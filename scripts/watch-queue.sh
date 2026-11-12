#!/usr/bin/env bash
# Manual mode helper for a Claude Code session: waits until the bot's queue has work
# (photos to analyse or a text to rewrite), prints it and exits, so the session wakes up.
# Gives up after MAX_MINUTES (default 110) so it can be restarted within session limits.
set -uo pipefail
cd "$(dirname "$0")/.."
interval=${INTERVAL:-15}
deadline=$(( $(date +%s) + ${MAX_MINUTES:-110} * 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  q=$(NODE_USE_ENV_PROXY=1 npx convex run manual:queue 2>/dev/null) || q=""
  if [ -n "$q" ] && echo "$q" | jq -e '(.analyze | length) + (.rewrite | length) > 0' >/dev/null 2>&1; then
    echo "QUEUE_READY"
    echo "$q"
    exit 0
  fi
  sleep "$interval"
done
echo "QUEUE_WATCH_TIMEOUT"
exit 0
