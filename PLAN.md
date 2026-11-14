# Auto Reply Web: implementation plan (hand-off to the next agent)

Project: a web UI (a static site hosted on Vercel, working on the user's own file in their browser) for editing the config of the **Auto Reply** plugin for Leafyrino (a Chatterino fork). Separate, optional project. The plugin lives in `../auto-reply-plugin/` and must stay installable and fully working without this app. Read `docs/CONTRACT.md` first: it is the authoritative description of the plugin's config file and its pitfalls. Chat language with the owner: English. The owner's audience is Russian-speaking streamers; the UI text is **Russian**.

## 0. Status (updated 2026-11-14)
| Phase | State |
|---|---|
| 0 Environment | **Done** (`docs/phase-0-plan.md`, ADR 0001 accepted) |
| 1 Core | **Done on the dev Mac** (`docs/phase-1-plan.md`), built for the old local-server design; the config model, merge, ids and Lua host are reused, the server pieces are dormant (see 0a) |
| 2 Shell and Settings | **Done on the dev Mac** (`docs/phase-2-plan.md`): UI shell + Settings page, e2e in a real browser. It still reads and writes through the dormant local API stand-in |
| 2b Hosted data layer | **Done on the dev Mac** (`docs/phase-2b-plan.md`): browser file access (File System Access API), open/download fallback, demo mode, backups in browser storage, change polling; the old local server is deleted. Pending: the owner's manual check on real folders |
| 3-7 | Not started |

**Postponed by the owner:** the first CI run (nothing is pushed yet). Windows and Intel-macOS no longer matter for customers (there is no download), only browser support does (see 0a).
**Open owner decision:** write `[]` instead of `{}` for emptied lists (`[]` is VERIFIED to load on Leafyrino Nightly 2.5.5, macOS; see `docs/manual-checks/empty-lists.md`). Until decided the app writes `{}`.

## 0a. Architecture change (2026-11-14): hosted static site
The owner dropped the local app and the release build. The site is static, hosted on Vercel; customers open a URL and install nothing. Everything runs in the browser and nothing leaves it: no server receives the config.
- **File access:** the File System Access API (Chrome, Edge, Opera): the user picks `config.json` once, the site reads and saves it in place and remembers the handle. In Firefox and Safari the same screens use "open file" and "download the result". UNVERIFIED so far: whether the browser lets users pick files under `AppData` / `Library/Application Support`, permission re-prompts after a restart, and how the real plugin reacts to an in-place write.
- **Removed:** the compiled executable and bundles, the release pipeline (old section 4a), the customer-download docs, Windows/macOS packaging, the browser opener, the exit-with-last-tab lifecycle, the prepare-script toolchain download for Windows, `release-check`.
- **Deleted in Phase 2b:** `src/server/` (HTTP API, file store, discovery, settings) and the dev proxy; its file-store logic moved to `src/ui/data/store.ts`. Git history keeps the old server.
- **Reused:** `src/shared` (config model, merge, ids, features), `src/lua` (WASM Lua host), `src/ui` (shell and Settings page).
- **Local development:** `pnpm dev` (Vite dev server with hot reload; demo mode or a real folder in Chrome/Edge), `pnpm preview` (the production build with the production CSP), `pnpm build` (output `dist`, what Vercel deploys), `vercel.json` (headers; tested against `src/shared/security-headers.ts`).
- **Affected edge cases (section 3):** 1, 10, 11, 12, 13 are rewritten for the browser; 15 gains "no analytics, no third-party scripts, nothing sent anywhere".

Phase deliverables are described in sections 3 and 4; the phase plans in `docs/` record what was actually built and where it differs.

## 1. Decisions already made with the owner
| Topic | Decision |
|---|---|
| Architecture | **Static site on Vercel**, all logic in the browser (see 0a). Supersedes the earlier local-app design. |
| Config location | The user picks `config.json` (File System Access API, or open/download in other browsers); the site shows where the file normally lives (CONTRACT §1) and remembers the handle. No scanning: a website cannot list folders. |
| Running app | UI writes the file, then tells the user to run `/autoreply reload`. No plugin change. Detect external changes (content hash) by re-reading the file before every save, merge, keep a backup, write through the browser's atomic writable stream. |
| Distribution | **A URL.** Vercel hosts the static build (`dist`); nothing to download or install. |
| Developer setup | `scripts/prepare.sh` (macOS/Linux): pinned pnpm, install, lint, typecheck, tests, build, e2e. `pnpm dev` for the Vite server. |
| Rule evaluation | **Run the plugin's real Lua in the browser** (WebAssembly Lua 5.4, e.g. `wasmoon`) for validation and the live "test message" preview. No second implementation of the matching logic. |
| Language | Russian only; all strings in one dictionary module (`src/i18n/ru.ts`) so another language can be added later. |
| v1 editable scope | All config **except live state**: settings, rules (conditions, reply, channels, skip, names, enable, order), timers (conditions, reply, format, category behaviour, skip, enable), redeems, ignore/protect users. Not editable: `active_until` (master on/off), timer `started_at`/elapsed. Enabling a timer from the UI starts it "now" and the UI says so. |
| Pages | One page per feature (settings, rules, timers, redeems, ...). The main page gives quick access to them; **its exact layout is decided later with the owner**. |
| Onboarding | Built **after** everything else works. Skippable. Phase 7; only leave room for it earlier (a first-run flag in the app's own settings). |

## 2. Architecture (target)
```
Vercel (static files: HTML, JS, CSS, worker, glue.wasm)  -->  browser (SPA, Russian UI)
browser:
   |-- File System Access API (or open/download): the user's config.json, read, merged, backed up, written in place
   |-- vendored plugin Lua (util, rules, names, config sanitiser) run in WASM Lua inside a Web Worker
   `-- app settings and backups in the browser's own storage (IndexedDB), never sent anywhere
```
- The Lua runs **client-side** in the browser (preview must be instant while typing). There is no server of ours at runtime.
- `vendor/plugin/` holds copies of the plugin's pure Lua modules (`util.lua`, `rules.lua`, `names.lua`, the sanitising part of `config.lua`) plus a small shim for `c2`/`chatterino.json`. `scripts/sync-plugin` copies them from `../auto-reply-plugin/auto-reply/` and records the plugin version + file hashes; CI fails if the vendored copy drifted from the recorded hashes. A contract test loads the real sample configs through the vendored Lua.
- The app keeps its own small settings (the remembered file handle, onboarding done) in the browser's storage for the site's origin, never inside the plugin folder.

## 3. Edge-case register (each needs a design decision in code + a test)
1. **Running app overwrites edits.** The plugin saves on every change; stale UI writes lose data. Handle: hash+mtime check before write (409 + "file changed, reload?" diff), backup `config.json.bak-<timestamp>` (keep last N), atomic rename. After a successful write show "Run `/autoreply reload` in Leafyrino" with a copy button. `reload` also drops a session-only "on": say so.
2. **Live state fields.** Never write `active_until`, timer `started_at`/`game_id`/`enabled` from stale data: on save, re-read the file and merge: take live fields from disk, user-edited fields from the UI. "Enable timer" sets `enabled=true, started_at=now` (like the plugin's `start_counting`, without `game_id`) and warns.
3. **`{}` for empty lists** and legacy shapes (rule `type/match`, timer `trigger`): normalise on read (keep unknown keys), write `[]`/new shapes only for items the user edited; do not rewrite untouched items gratuitously (minimal diff).
4. **Ids and counters.** Ids are never reused; keep `next_*_id` correct, also when items are deleted or reordered. Order = array order = priority for rules (first match wins): the UI needs explicit reorder and shows "priority" clearly.
5. **Names.** 1-20 chars, unique per kind, reserved words. Validate with the plugin's own `names.lua` in WASM.
6. **Conditions builder.** AND only. Show a plain-language description (reuse the plugin's `TYPE_INFO`/`FLAG_INFO` texts via vendor), warn on the classic mistakes (the stream bug: `keyword` matches inside words like `донаты`; `|` inside `keyword`/`word`; pattern without special characters). Offer "whole word" as the default type.
7. **Preview.** Input: sample message, sender role (viewer/mod), flags, account login. Output: which rule/timer wins, the rendered reply, why the others did not match (the plugin's `test` command logic). Unicode behaviour comes from the real Lua. Check how WASM Lua handles non-ASCII (Cyrillic) strings and `string.lower`, and `pcall` around user Lua patterns (a catastrophic pattern must not freeze the tab: run in a Web Worker with a timeout).
8. **Channel scope.** Rules bound to a channel absent from `channels` are dormant: flag it in the list. Channel names: lowercase login, no `#`.
9. **Version gating.** Read `../info.json` version; disable/explain controls the installed plugin cannot use (CONTRACT §5). Unknown newer fields are preserved.
10. **Corrupt or missing file.** Missing: offer default config. Invalid JSON: read-only view + message, never overwrite silently; mirror the plugin's `config.json.bad` behaviour.
11. **Wrong file / several installs.** The user picks the file, so: show the picked file's name and folder (path hidden on screen by default, privacy), refuse anything not named `config.json`, warn if the content does not look like the plugin's config, confirm before the first write. The site explains where the file normally lives per OS (CONTRACT §1).
12. **Security (hosted site).** Strict CSP and security headers on every response (`src/shared/security-headers.ts`, mirrored in `vercel.json`, tested); no third-party scripts, fonts, analytics or network calls beyond its own origin; the config never leaves the browser; no cookies; permissions limited to the file the user picked. Dependencies pinned and audited; build from the lockfile.
13. **Browser support.** Direct file access needs a Chromium browser; the fallback (open/download) works everywhere. Handle: permission lost or revoked, file moved or deleted, the handle surviving a restart (re-prompt), writes failing while Chatterino holds the file (retry, then fall back to download), private windows (no persistence). Windows/macOS specifics now concern only the file dialog (hidden `AppData` / `Library` folders) and are UNVERIFIED until tested.
14. **Redeem/moderation features.** The plugin's mod-badge and reward-title detection are UNVERIFIED in the real app: the UI can edit them but must label the feature as "needs a moderator account" and not promise behaviour.
15. **Secrets and privacy.** The config can hold private channel names and links: never log config contents; backups stay next to the config.
16. **Large/hand-edited configs.** Hundreds of rules: list virtualisation, search/filter, bulk enable/disable.
17. **Undo.** Local undo/redo of unsaved edits, dirty-state warning on navigation, "revert to last saved" and "restore backup".

## 4. Phases and acceptance criteria

### Phase 0 - Environment (DONE; see docs/phase-0-plan.md)
Deliverables:
1. `git init`, `.gitignore`, `README.md` skeleton, licence placeholder (ask the owner), `CLAUDE.md` kept up to date.
2. **Stack decision record** `docs/adr/0001-stack.md` backed by short spikes (throw-away code in `spikes/`, each with a pass/fail result):
   - *Lua in the browser*: `wasmoon` (Lua 5.4) loads vendored `rules.lua`/`util.lua`/`names.lua`, matches Cyrillic correctly, `rules.matches_one` gives the same answers as the real `lua` on the plugin's `tests/cases/unit_rules.lua` table; measure load time and bundle size. Fallback candidate: `fengari` (Lua 5.3: check `utf8`, integer division and bitwise operators used by the vendored files).
   - *Server + single executable*: candidates Bun (`bun build --compile`, cross-targets windows-x64, darwin-arm64, darwin-x64), Node SEA, Deno compile, Go with `embed`. Criteria: produces a working Windows .exe and macOS binaries without a runtime on the target, size, build time, ability to serve static assets and a small JSON API, atomic file replace semantics on Windows.
   - *UI stack*: TypeScript + Vite; choose between Svelte and React (+ a component kit such as shadcn/ui or Radix) by: bundle size, form/list/drag-and-drop ergonomics (rule reorder), accessibility. Tailwind or CSS modules for styling. Drag and drop: `dnd-kit` (React) or the Svelte equivalent. Schema validation for the app's own data: `zod`/`valibot`.
   - *Tests*: Vitest (unit), Playwright (e2e against the built executable), `lua` CLI cross-check of the vendored modules.
   Recommended starting point to verify, not a decision: TypeScript, Vite, Svelte or React, Bun (server + compile), wasmoon, Vitest, Playwright.
3. **Prepare scripts** (`scripts/prepare.ps1`, `scripts/prepare.sh`): idempotent; no admin rights required (download portable toolchain archives into `./.tools/` with pinned versions and SHA-256 checks; use winget/brew only if present and the user agrees); install dependencies from the lockfile; run lint, unit tests and a build smoke test; print the next command. A `--check` mode only reports what is missing. Document them in the README.
4. **SDLC setup for Claude Code** in `.claude/` (the owner asked to "download important skills, add skills or agents for SDLC"): 
   - Agents (`.claude/agents/*.md`, each with a narrow role, tool list and a "definition of done"): `architect` (ADRs, contract guardian: owns `docs/CONTRACT.md` and the vendoring), `frontend-dev` (UI in Russian, accessibility), `backend-dev` (server, file safety, security), `qa-tester` (unit/e2e/mutation checks, replays the plugin's sample configs), `security-reviewer` (the localhost server threats in §3.12), `release-engineer` (bundles for Windows/macOS, checksums, SmartScreen/Gatekeeper notes), `docs-writer` (customer README in Russian).
   - **Skills already installed (owner-approved, see `docs/sdlc.md`):** `unslop` (heydamir), `test-driven-development` and `verification-before-completion` (obra/superpowers), `web-design-guidelines` (vercel-labs), all in `.claude/skills/`; `ui-ux-pro-max` is used from the owner's user-level install. Still to decide with the owner: `webapp-testing` (Phase 1) and a framework best-practices skill after the stack ADR.
   - Skills/commands: reuse what is already installed in the owner's Claude Code (for UI work: `frontend-design`, `ui-ux-pro-max`, `ui-styling`, `design-system`, `code-review`, `simplify`, `security-review`, `run`); add project commands `/adr`, `/spike`, `/contract-check` (re-run vendor sync + contract tests), `/release-check`. Search for further useful skills (testing, accessibility, i18n) and list them with a one-line justification before installing anything; ask the owner before installing third-party skills (they run with the agent's permissions).
   - Update `CLAUDE.md` with the working rules (below) and the commands to run tests/build.
5. CI skeleton: `.github/workflows/ci.yml` (on push/PR: lint, unit tests, vendored-plugin drift check, build smoke on `windows-latest` and a macOS runner). The repo is `https://github.com/PavloProkopenko/chatterino-auto-reply-web-ui` (remote `origin` is already configured locally; nothing pushed yet). The release workflow is specified in section 4a and implemented in Phase 6; Phase 0 only reserves the version/tag conventions.
Acceptance: a fresh clone + `scripts/prepare.*` reaches a green lint/test/build smoke on the dev Mac; ADR 0001 merged with spike evidence; agents/skills documented in `docs/sdlc.md`.

### Phase 1 - Core (no UI polish) (DONE on macOS; see docs/phase-1-plan.md)
Config discovery, safe read/write (backup, hash/mtime, atomic, Windows retry), normalisation and live-field merge, vendored Lua in WASM, version gating, API with token/Host checks, contract tests with `config.customer.json`-style fixtures (legacy shapes, `{}` lists, unknown keys).
Acceptance: round trip of every sample config is byte-stable apart from intended edits; concurrent-write test (simulated plugin save) yields 409 not data loss; security tests (bad Host/token rejected).
Outcome: all met locally (168 tests; plugin sample configs round-trip byte-stable). Not met yet: the Windows/Intel CI run (postponed). Differences from this text: no Lua HTTP endpoint (Lua runs in the browser); empty lists stay `{}` for now.

### Phase 2 - Shell and Settings page
App shell (navigation, dirty state, save bar, "run /autoreply reload" banner), config picker/fallback, Settings page (cooldowns, only-when-live, skipmods, mute lurkers, backfire, channels, ignore/protect users) with inline validation.

### Phase 3 - Rules page and constructor
List (search, order/priority, enable/disable, bulk), constructor (type pickers with plain-language help, AND chain, reply with placeholder helper and length counter, channels, skip, name), live preview from the real Lua, warnings from §3.6.
Acceptance: the donate/playlist/timer scenarios from the plugin's labelled chat fixtures pass through the UI's preview with the same results as the plugin's `lua tests/run.lua` (dev-only cross-check).

### Phase 4 - Timers and Redeems pages
Same builder for timers (`{time}` required, format, category behaviour, enable-now semantics) and redeems (title, action, duration with `30m` parsing, mod-account notice).

### Phase 5 - Main page
Quick access cards (rules, timers, redeems, settings), at-a-glance status from the file (counts, dormant items, warnings). Layout decided with the owner at this point.

### Phase 6 - Hosting on Vercel (replaces "Packaging and customer delivery")
Connect the repository to Vercel, production and preview deployments, the production headers (`vercel.json`), a custom domain if wanted, a short Russian customer page or in-app help (where the file is, which browser to use, the `/autoreply reload` step), and a smoke test of the deployed URL in Chrome and in a non-Chromium browser. No release artifacts, no signing, no bundles.

### Phase 7 - Onboarding (last)
Skippable first-run tour explaining pages, constructor, preview and the reload step; "show again" in settings.

### 4a. Deployment (Vercel)
- Build: `pnpm build` produces `dist`; install with the lockfile only (`pnpm install --frozen-lockfile`). `vercel.json` sets the install and build commands and the security headers. UNVERIFIED until the first deployment: pnpm 12 on Vercel's build image (the config installs it with npm instead of corepack, which cannot start pnpm 12).
- Every push gets a preview deployment; the production branch deploys to the production URL. Rollback is "promote a previous deployment".
- CI (GitHub Actions, written but not run yet): lint, typecheck, unit tests, vendored-plugin drift check, production build, Playwright e2e on Linux.
- Version source of truth: `package.json`; `CHANGELOG.md` per change.

## 5. Working rules for the agent (also copied into CLAUDE.md)
- Plan before code. For each phase: re-read this plan, ask the owner about any edge case or open decision not covered here (AskUserQuestion), write a short phase plan, wait for the go-ahead, then implement. Never implement beyond the approved phase.
- Never commit or push without the owner asking. Do not install third-party skills/agents without asking.
- Never put real chat logs or customer configs into the repo; use synthetic fixtures. The plugin repo is read-only from here: any plugin change (for example the pure `check_reply` extraction in CONTRACT §6) is a separate request to the owner.
- Keep the UI strings Russian and in the dictionary file; keep code, comments, commit messages and docs English (except customer-facing docs).
- Every behaviour that depends on the plugin must be covered by a contract test against the vendored Lua. Mark anything not verified in the real Leafyrino app as UNVERIFIED in docs.
- Prefer small, boring dependencies; pin versions; record each dependency's reason in the ADR.

## 6. Deferred decisions (ask the owner when reached)
First CI run and pushing the repo (postponed); Vercel project and domain name; `{}` vs `[]` when emptying a list; Project/app name and licence; main-page layout (Phase 5); onboarding content (Phase 7); release channel (GitHub Releases or direct file) and code signing; whether to add the optional hot-reload poll to the plugin later (rejected for v1); a future "run my real chat logs through the rules" feature (Chatterino keeps logs in its `Logs` folder; the plugin repo already has the replay harness idea).
