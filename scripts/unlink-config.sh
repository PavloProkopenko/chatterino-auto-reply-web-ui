#!/usr/bin/env bash
# Undo link-config.sh: removes the link and restores the newest backup of the original plugin folder
# (or copies the linked folder back when there is none). Files in the target folder are left untouched.
# Usage: unlink-config.sh <plugin-dir>
set -euo pipefail
PLUGIN="${1:-}"
[ -n "$PLUGIN" ] || { echo "usage: $0 <plugin-dir>" >&2; exit 2; }
PLUGIN="${PLUGIN%/}"
[ -L "$PLUGIN" ] || { echo "$PLUGIN is not a link." >&2; exit 1; }
if pgrep -i 'chatterino|leafyrino' >/dev/null 2>&1; then
  echo "Close Leafyrino/Chatterino first." >&2; exit 1
fi
TARGET="$(readlink "$PLUGIN")"
BACKUPS="$(dirname "$(dirname "$PLUGIN")")/auto-reply-backups"
LATEST=""
if [ -d "$BACKUPS" ]; then
  LATEST="$(ls -1d "$BACKUPS/$(basename "$PLUGIN")"-* 2>/dev/null | sort | tail -n 1 || true)"
fi
rm "$PLUGIN"
if [ -n "$LATEST" ] && [ -d "$LATEST" ]; then
  mv "$LATEST" "$PLUGIN"
  echo "Restored $PLUGIN from $LATEST (changes made in $TARGET are NOT copied back)."
else
  mkdir -p "$PLUGIN"; cp -R "$TARGET/." "$PLUGIN/"; rm -f "$PLUGIN/data/.external"; rm -rf "$PLUGIN/.backup"
  echo "No backup found: copied the files from $TARGET."
fi
echo "Done. Files in $TARGET were left untouched."
