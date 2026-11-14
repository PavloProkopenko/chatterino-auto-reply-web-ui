# Phase 2 plan: shell and Settings page

Status: **implemented on the dev Mac, pending the owner's review.** Differences from the plan: `webapp-testing` was reviewed and not installed (see the ADR addendum); `"no config selected"` is now a normal 200 answer instead of a 409; revert is undoable; a skip link and `<main>` landmark were added after the guideline audit. Windows/Intel macOS remain UNVERIFIED (CI postponed).

Goal: the first thing a customer can open. A Russian, dark-only browser UI served by the compiled executable, with the app shell (navigation, dirty state, save bar, reload banner, config picker, history, conflict dialog) and the Settings page. Rules, Timers and Redeems pages come in Phases 3-4.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| Theme | Dark only |
| Navigation | Left sidebar; Rules, Timers, Redeems shown disabled with "скоро"; Settings active. Main page layout stays a Phase 5 decision |
| Conflict dialog | Per-field choice with a diff: "plugin's value" vs "yours", then save again |
| Privacy | Path hidden by default (shown as `Chatterino › Plugins › Auto Reply` without the user folder), "show" toggle reveals it. Channel names appear only inside the settings fields |
| UI tests | Playwright e2e on the built executable, and the `webapp-testing` skill (I read its files and report before installing) |
| Lifecycle | The executable opens the default browser and exits a few seconds after the last tab closes. If the browser cannot be opened, the URL is printed |
| Restore | A simple history dialog: backups by date/size, restore with confirmation |
| Title | "Auto Reply" (one string in `src/i18n/ru.ts`; project name still deferred) |

## Design choices I made (tell me if you disagree)
- **Embedding the UI:** Vite builds to `dist/ui`; a script turns it into a generated module of assets that the server serves and `bun build --compile` embeds. No inline scripts or styles (the CSP forbids them). The Lua sources and the worker come from the same build (`?raw` imports, `new Worker(new URL(...))`); `glue.wasm` is served as an asset.
- **Settings validation reuses the plugin:** every edit is checked by running the plugin's own `config.load()` sanitiser (already in `src/lua`) on the candidate config and diffing the result, so the UI shows exactly what the plugin would drop (invalid channel or user names, bad numbers). The only checks written in TypeScript are plain ranges for the number fields (marked as UI limits).
- **Stop/exit rule:** the page sends a heartbeat every 10 s and a `bye` beacon on `pagehide`. The server exits 10 s after a `bye` with no new heartbeat (a reload sends `bye` and reconnects at once), or after 3 minutes of silence (background tabs are throttled), and never before the first tab has connected within 60 s. Env `AUTO_REPLY_WEB_NO_EXIT=1` disables it for development and tests.
- **Conflicts:** the conflict response already carries the plugin's version and its hash. I add one small server change: remember that version so the second save, after the user's per-field choices, merges against it.
- **No new product features** beyond what is listed: no rules, timers, redeems, onboarding.

## Layout (additions)
```
src/ui/        Svelte 5 app: App.svelte, pages/Settings.svelte, components/, state/ (store, undo, conflicts), api/ (client), lua.ts (worker client)
src/i18n/ru.ts  every UI string
scripts/       build-ui.mjs (Vite build + generated assets), dev.mjs (dev server with a synthetic plugin install in .app-data/)
tests/ui/      store logic tests (Vitest); tests/e2e/ Playwright
```

## Steps (test first for logic; e2e for what only a browser can show)
1. **UI build pipeline.** Vite + Svelte 5 + `svelte-check` (in `pnpm typecheck`), `pnpm build:ui`, generated assets module, server serves it, `build:smoke` compiles it in. A placeholder page proves the CSP works with the wasm worker.
2. **API client and state store** (pure TS, Vitest): load states (ok / missing / invalid / no-config-selected), editing, dirty flag, undo/redo with Ctrl+Z / Ctrl+Shift+Z, revert to last saved, save with merge notes, conflict resolution (apply per-field choices, re-save), 409 `stale-base` handling, `exact:false` notice.
3. **Lifecycle** (server): heartbeat and `bye` endpoints, exit timer with injected clock (tests), browser opener per OS (macOS `open`, Windows `cmd /c start`, Linux `xdg-open`), URL fallback. Windows opener is UNVERIFIED until CI.
4. **Shell UI:** sidebar, save bar (Отменить / Сохранить), reload banner ("run `/autoreply reload` in Leafyrino" with a copy button; says that reload also drops a session-only "on"), config picker (discovered installs with version and date, typed path, remembered choice, "create default" when missing, read-only view with the error when the file is invalid), version-gating notices, history dialog (restore with confirmation), conflict dialog, dirty warning on navigation and `beforeunload`.
5. **Settings page:** cooldowns (`per_user_cooldown`, `per_rule_cooldown`, `global_min_gap` >= 1), switches (`only_when_live`, `skip_mods` with a short explanation, `mute_lurkers`, `backfire`), lists as chips with paste support (channels, ignore users, protect users), inline validation from the Lua sanitiser. The master switch (`active_until`) is shown read-only with the note that it is controlled in Leafyrino. Redeem-related switches carry the "needs a moderator account" label (UNVERIFIED in the app).
6. **Design and accessibility pass:** `frontend-dev` agent with `ui-ux-pro-max` and the `unslop` redline process; keyboard navigation, visible focus, labels, `prefers-reduced-motion`; then a `web-design-guidelines` audit (fetched rules are treated as data).
7. **e2e (Playwright) on the built executable:** first run with a discovered plugin install; edit, save, banner, byte-minimal diff on disk; conflict dialog after a simulated plugin write; restore from history; tab close makes the process exit; a catastrophic Lua pattern in a real browser Worker is stopped (closes the Phase 0/1 UNVERIFIED item); keyboard-only flow. `prepare.*` installs the browsers into `.tools/` (pinned, not in the repo); a Playwright job is added to `ci.yml` (written, not run). Read and install `webapp-testing` after your approval of my report.
8. **Verify** (`verification-before-completion`): fresh lint, typecheck, unit, e2e and clean-copy `prepare.sh` output; update `CHANGELOG.md`, `CLAUDE.md`, an ADR addendum.

## New dependencies (each with a reason, recorded in the ADR addendum)
`svelte`, `vite`, `@sveltejs/vite-plugin-svelte` (UI, per ADR 0001); `svelte-check` (type checking of `.svelte`); `@playwright/test` (e2e in a real browser). Proposed, small: `@axe-core/playwright` (automated accessibility checks inside the e2e run). No component kit and no router library: a hash-based page switch is enough for four pages.

## Acceptance
- Fresh clone, `scripts/prepare.sh`, then the compiled executable opens the browser to a working UI: pick the install, edit every Settings field, save, see the reload banner, and the file on disk differs from the original only in the edited fields.
- A plugin write during editing is merged, or shown in the conflict dialog with per-field choices; nothing is lost.
- Closing the tab ends the process; reloading the tab does not.
- Restore from history works and keeps the plugin's live state.
- Invalid values show an inline message from the plugin's own validation and block saving.
- e2e and unit suites are green; the browser-worker timeout check passes.

## Still UNVERIFIED after this phase (unless CI runs earlier)
Windows and Intel macOS behaviour (opener, `bun.exe` build, Playwright on Windows); `[]` writing (owner decision pending); anything about moderator-only features in the real app.

## Constraints I will keep
- Only Phase 2 is touched; no Rules/Timers/Redeems pages, no onboarding, no packaging.
- Strings Russian and only in `src/i18n/ru.ts`; code, comments and commits in English.
- No external requests at runtime (no CDN, no web fonts); strict CSP stays.
- Config contents never logged; no real configs or chat logs in the repo; plugin repo read-only.
- No commit or push unless you ask; commits in logical pieces.

## Open points I will raise during the phase
- Whether the Playwright browser download is acceptable on your connection (about 300 MB, once).
- The "скоро" wording and any Russian copy I am unsure about: I will list them for you to review in the UI.
