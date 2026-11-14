# Request for the Auto Reply plugin: a config location the browser can reach

Status: **draft, not sent.** The plugin repo is read-only from this project; this is a request for a separate piece of work.

## Problem
The web UI edits `data/config.json`, but Chrome and Edge refuse to open folders and files under the app's data directory (`~/Library/Application Support/chatterino/Plugins/...` on macOS, probably `%APPDATA%` on Windows) because they count as system locations. Users must open the file, download the result and copy it back by hand.

## Proposal (pick one, or both)
1. **User-chosen config path.** An optional setting (for example `/autoreply configpath <folder>`) that tells the plugin to read and write `config.json` in a folder such as `~/Documents/AutoReply/`. The web UI could then edit that file in place. The default stays the current `data/config.json`, so the plugin keeps working without the web app.
2. **Import command.** `/autoreply import <path>` copies a file from a normal folder (for example Downloads) over `data/config.json`, validates it, keeps a backup, then reloads. Removes the manual copy step.

## Questions for the plugin side
- Can a Leafyrino plugin read and write outside its own folder (sandbox, permissions)? UNVERIFIED.
- Where should the chosen path be stored, and what happens if the folder disappears?
- Validation and backup behaviour for an imported file; reload semantics (the plugin reads config only at start or `/autoreply reload`).
- Windows path handling.

## Compatibility
Empty lists as `{}` or `[]`, unknown keys preserved, ids never reused, live state never overwritten from stale data (see `docs/CONTRACT.md`).
