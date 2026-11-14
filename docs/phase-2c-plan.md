# Phase 2c plan: open + download as the main flow

Status: **implemented on the dev Mac** (unit, e2e, lint, typecheck and vendor check pass). Real Windows and the real Leafyrino folder stay UNVERIFIED. Differences from the plan: the re-open step is asked before every download (no time-based shortcut); after the owner's follow-up, the production welcome screen has only "Открыть config.json" (direct access and the folder button stay in dev/e2e builds only, code kept); the plugin version comes from an optional second file, `info.json`, offered in a banner after opening, and stays unknown if the user skips it.

## Why
Owner test (macOS, Chrome): `~/Library/Application Support/chatterino/Plugins/` is refused with "can't open this folder because it contains system files", and picking `data/config.json` as a single file is refused too. Chrome's blocklist covers the plugin location, so direct in-place editing is not available there. We expect the same on Windows under `%APPDATA%` (UNVERIFIED). Direct access stays as a bonus for locations Chrome accepts.

## Owner decisions
| Topic | Decision |
|---|---|
| Main flow | Open `config.json` through a plain file dialog (not blocked), edit, download the new file, user puts it in place and runs `/autoreply reload` |
| Direct access | Kept, but demoted to a secondary option; never presented as the default for the plugin folder |
| Stale file | Before the download the user is asked to re-open the current `config.json`; live state (`active_until`, timer `started_at`/`game_id`/`enabled`) is merged from the fresh file, never from the old snapshot |
| Plugin change | Separate request, drafted in `docs/plugin-request-config-location.md`; nothing is changed in the plugin repo from here |

## Design
- **Welcome screen order:** 1) "Открыть config.json" (file input, all browsers), 2) "Попробовать на примере", 3) "Выбрать папку напрямую" with a short note that Chrome refuses system folders such as Library and AppData.
- **Before the dialog:** the exact path per OS with a copy button, the dialog tip (macOS Cmd+Shift+G, Windows paste into the address bar), and a plain statement that the site cannot open the plugin folder directly.
- **After the dialog (read):** reuse the `upload` source (read-only snapshot, save = download).
- **Save:** the save bar becomes a two-step action: "Открыть актуальный файл" (re-open, merge live state, show what changed) then "Скачать config.json". After the download: where to put the file, a copy-able `cp` / `copy` command with the real destination, then `/autoreply reload`.
- **Errors:** a refused folder shows a message that explains the blocklist and points to the file button instead of the current generic text (`blocked` in `src/i18n/ru.ts`). Chrome's own dialog cannot be detected or suppressed; the screen warns before it can appear.
- **No conflict detection** in this path beyond the re-open step; the screen says so.
- **Unchanged:** privacy rules, strict CSP, no network, merge code, vendored Lua.

## Steps (test first)
1. Unit tests for the re-open-and-merge step over the in-memory port (live fields come from the fresh file, unknown keys kept, ids not reused).
2. `upload` source: two-step save flow in the session; tests.
3. Welcome screen order, path blocks per OS, copy buttons, new strings in `src/i18n/ru.ts`.
4. Post-download instructions with the command and the destination.
5. Playwright e2e: open file, edit, re-open changed file, download; direct access path still works with OPFS.
6. Verify (lint, typecheck, unit, e2e, vendor check), update `CHANGELOG.md`, `PLAN.md`, `docs/manual-checks/file-access.md` with the blocklist result.

## Open items
- Windows blocklist and the real Leafyrino plugin folder: UNVERIFIED until the owner or a customer tries.
- Safari/Firefox: unchanged, still UNVERIFIED in a real browser.
