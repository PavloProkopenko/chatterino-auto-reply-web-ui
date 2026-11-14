#!/usr/bin/env bash
# Optional external plugin folder for the Auto Reply plugin (macOS/Linux).
# Makes <Plugins>/<plugin folder> a symlink to TARGET, so the web UI can open and update the whole plugin there.
# Usage: link-config.sh <target-folder> [plugin-dir]
# The original plugin folder is moved to <app data>/auto-reply-backups/ (NOT next to it: Leafyrino loads every
# folder inside Plugins, so a leftover copy there would register the plugin twice).
set -euo pipefail

TARGET="${1:-}"
PLUGIN="${2:-}"
[ -n "$TARGET" ] || { echo "usage: $0 <target-folder> [plugin-dir]" >&2; exit 2; }

is_plugin() { [ -f "$1/info.json" ] && grep -q '"name"[[:space:]]*:[[:space:]]*"Auto Reply"' "$1/info.json"; }

if [ -z "$PLUGIN" ]; then
  matches=()
  for root in "$HOME/Library/Application Support" "${XDG_DATA_HOME:-$HOME/.local/share}"; do
    [ -d "$root" ] || continue
    for info in "$root"/*/Plugins/*/info.json; do
      [ -f "$info" ] || continue
      grep -q '"name"[[:space:]]*:[[:space:]]*"Auto Reply"' "$info" && matches+=("$(dirname "$info")")
    done
  done
  if [ "${#matches[@]}" -eq 0 ]; then echo "Plugin folder not found; pass plugin-dir as 2nd argument." >&2; exit 1; fi
  if [ "${#matches[@]}" -gt 1 ]; then
    echo "Several installs found, pass one as 2nd argument:" >&2; printf '  %s\n' "${matches[@]}" >&2; exit 1
  fi
  PLUGIN="${matches[0]}"
fi
PLUGIN="${PLUGIN%/}"

if pgrep -i 'chatterino|leafyrino' >/dev/null 2>&1; then
  echo "Leafyrino/Chatterino seems to be running. Close it first, then run this again." >&2; exit 1
fi
[ ! -L "$PLUGIN" ] || { echo "$PLUGIN is already a link -> $(readlink "$PLUGIN"). Run unlink-config.sh first." >&2; exit 1; }
[ -d "$PLUGIN" ] || { echo "$PLUGIN is not a folder." >&2; exit 1; }
is_plugin "$PLUGIN" || { echo "$PLUGIN does not contain the Auto Reply plugin (info.json)." >&2; exit 1; }

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"
case "$TARGET/" in "$PLUGIN"/*) echo "Target must not be inside the plugin folder." >&2; exit 1;; esac

if [ -z "$(ls -A "$TARGET")" ]; then
  cp -RL "$PLUGIN/." "$TARGET/"            # -L: an old data-only link is copied as real files
elif is_plugin "$TARGET"; then
  # the site already installed the plugin there: keep its code, bring over the config if it has none
  if [ ! -f "$TARGET/data/config.json" ] && [ -f "$PLUGIN/data/config.json" ]; then
    mkdir -p "$TARGET/data" && cp -L "$PLUGIN/data/config.json" "$TARGET/data/config.json"
  fi
else
  echo "Target folder $TARGET is not empty and is not the Auto Reply plugin. Choose an empty folder." >&2; exit 1
fi

BACKUPS="$(dirname "$(dirname "$PLUGIN")")/auto-reply-backups"
BACKUP="$BACKUPS/$(basename "$PLUGIN")-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUPS"
mv "$PLUGIN" "$BACKUP"
mkdir -p "$TARGET/data"
touch "$TARGET/data/.external"
ln -s "$TARGET" "$PLUGIN"
echo "Done: $PLUGIN -> $TARGET"
echo "The original folder is kept at $BACKUP"
echo "Start the app and run /autoreply status (should say external folder)."
echo "Undo: unlink-config.sh \"$PLUGIN\""
