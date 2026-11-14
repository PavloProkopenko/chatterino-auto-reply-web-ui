# Phase 2b plan: the browser file layer (hosted site)

Status: **implemented on the dev Mac, pending the owner's manual check on real folders** (`docs/manual-checks/file-access.md`). Differences from the plan: none of substance; `src/ui/fsa-check.*` stays until the check is done.

Goal: the site reads and writes the user's real `config.json` itself, in their browser, with no server of ours. After this phase `pnpm dev` and the Vercel build serve only the site, the dormant local API is gone, and nothing is ever sent over the network.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| What the user picks | The plugin folder (`.../Plugins/<plugin>/`). One permission gives `info.json` (plugin version, so unsupported settings stay disabled), `data/config.json` and room for the `data` folder to be created. Falls back to picking only `config.json` if the folder dialog is refused |
| Backups | **Browser storage only** (IndexedDB, last 20, shown in the history dialog). Nothing extra is written into the plugin's data folder. They disappear if the user clears site data |
| Demo mode | Yes: "Попробовать на примере" loads a built-in sample in memory; saving offers a download. Works in every browser |
| Folder names | Same as stock Chatterino: Windows `%APPDATA%\Chatterino2\Plugins\...`, macOS `~/Library/Application Support/chatterino/Plugins/...` (UNVERIFIED for Leafyrino's real folder; the manual check below settles it) |
| Manual check | The owner tries the real folder and file in Chrome/Edge with a throw-away page, early |
| Firefox/Safari | Same phase, after direct access: open (file or folder) and download the result |
| Old server | Deleted at the end of the phase (git history keeps it) |
| Change detection | On tab focus plus a light poll (about every 10 s) while the tab is visible |

## Design
- **One interface, several sources.** The session talks to a `ConfigSource` (load, save, create default, list backups, restore, notice external change). Implementations: *folder* (File System Access API directory handle), *file* (a single file handle), *upload* (Firefox/Safari: read-only snapshot, save = download), *demo* (in memory, save = download). The same merge, conflict and render code as before runs in the browser: save re-reads the file, compares the content hash, merges or reports a conflict, keeps a backup, then writes through the handle's writable stream (the browser swaps it in atomically on close).
- **Port, not rewrite.** The logic in `src/server/store.ts` (hash, merge against remembered bases, conflict, stale base, invalid file, restore keeping live state, create default) moves to `src/ui/data/` over a small `FileAccess` port; its tests move with it, run against an in-memory port. Only the browser pieces (handles, permissions, IndexedDB) are new.
- **Remembering the choice.** The directory/file handle is stored in IndexedDB. On the next visit the page offers "Продолжить с папкой «auto-reply»" (a click is required to re-grant permission) and "Выбрать другую". Forgetting removes the handle and the backups.
- **No path on screen.** The browser only reveals names (`auto-reply`, `config.json`), never the full path, so the privacy toggle disappears. The sidebar shows the folder name.
- **Where is the file?** The welcome screen shows, per OS (from the browser), the usual location with a copy-path button, and the tip for the dialog (macOS: Cmd+Shift+G; Windows: paste the path into the address bar). It does not claim a path it cannot verify.
- **Failures are first-class:** permission revoked or not yet granted (re-grant button), file moved or deleted (back to the welcome screen with the reason), write refused or the file busy (retry briefly, then offer the download instead, with the same content), private windows (works, nothing is remembered; a notice says so), browser without direct access (fallback screens).
- **Fallback (Firefox/Safari):** "open the plugin folder" (`<input webkitdirectory>`, read-only, still gives `info.json`) or "open config.json"; saving downloads `config.json` and shows a short instruction: where to put the file, and then `/autoreply reload`. There is no conflict detection in this path, which the screen says plainly.
- **Security:** `connect-src 'self'` stays; an e2e test asserts the page makes no network request except for its own static assets. No analytics, no cookies, no third-party anything.

## Steps (test first for logic; real browser for what only a browser can show)
1. **Manual-check page** (throw-away, `pnpm dev` only, not in the production build): two buttons, "pick the plugin folder" and "pick config.json", reporting what the browser allowed (read, write, `info.json` found, a write-and-restore round trip on a copy you create). You run it on your real folders in Chrome/Edge and send me the result; the design follows it.
2. **Data layer port:** `FileAccess` port plus in-memory implementation; move load/save/merge/conflict/restore/create-default and their tests from `src/server/`; backups behind a `BackupStore` port (in-memory for unit tests, IndexedDB for the browser).
3. **File System Access implementation:** folder and file sources, permission checks and re-grant, handle persistence and forgetting, write retry then download fallback. Tested in Playwright with the browser's private file system (OPFS), which offers the same handle API, behind stubbed pickers.
4. **Session rewiring:** replace the `Api` dependency with `ConfigSource`; phases become welcome / needs-permission / missing / invalid / ready; external-change polling; update the session tests.
5. **Welcome screen and shell:** folder/file/demo/continue actions, OS instructions, browser-support notice, folder name in the sidebar, history dialog over browser storage.
6. **Fallback sources:** `upload` (file or `webkitdirectory`) and `demo`, the download-and-replace instructions, a banner that explains the missing conflict detection. Real Firefox/Safari stay UNVERIFIED; the fallback code path is exercised in Chromium by removing the picker APIs.
7. **Delete the old server:** `src/server/`, `tests/server/`, `scripts/devstack.ts`, the dev proxy, the API types it needed; `pnpm dev` is plain Vite; Playwright runs against `vite preview` through its own `webServer` entry; drop `valibot` if nothing else uses it.
8. **Vercel readiness:** `pnpm build` and `pnpm preview` verified with the production headers; no deployment is made (needs your Vercel account); a short deploy checklist in `docs/`.
9. **Verify:** fresh lint, typecheck, unit and e2e output; clean-copy `prepare.sh`; update `CHANGELOG.md`, `CLAUDE.md`, `PLAN.md`, the ADR addendum.

## Acceptance
- In Chrome/Edge: pick the real plugin folder, see its version recognised, edit Settings, save, and the file differs from the original only in the edited fields (your manual run).
- Reload the tab: one click continues with the same folder. Clearing the choice returns to the welcome screen.
- The plugin (simulated by a write from another handle) saves meanwhile: merged without loss, or the per-field conflict dialog.
- Restore from history works and keeps the plugin's live state.
- Demo mode and the fallback path work with no file access; saving offers a download with the right content.
- The page makes no network requests beyond its own static assets; `src/server/` and its proxy are gone.
- Unit and e2e suites green, including the dev-server render test.

## Still UNVERIFIED after this phase
Real Firefox and Safari; Edge and Opera (same engine, not run); Windows file dialogs and a real plugin write on Windows (needs a Windows machine or a tester); whether Leafyrino's live plugin picks up an in-place write the way `/autoreply reload` expects (your manual run covers macOS); `{}` vs `[]` when emptying a list (still your decision); pnpm 12 on Vercel's build image.

## Constraints I will keep
- Only Phase 2b is touched: no Rules/Timers/Redeems pages, no onboarding, no deployment.
- Strings Russian and only in `src/i18n/ru.ts`; code, comments and commits in English.
- No external requests, no analytics; config contents never logged.
- Plugin repo read-only; no real configs in the repo; the manual-check page never uploads anything.
- No commit or push unless you ask; commits in logical pieces.

## Open points I will raise during the phase
- The result of your manual check, if the browser blocks the plugin folder or `data` on your system (then the "pick only config.json" path becomes the main one).
- The Russian wording of the permission, privacy and "replace the file by hand" messages.
