# Phase 1 plan: core (no UI)

Status: **implemented, pending the owner's review.** Differences from the plan: no Lua HTTP endpoint (Lua runs in the browser, per the architecture); TypeScript 6.0.3 instead of 7 (see the ADR addendum). The owner's `[]` check is done (`[]` accepted, see `docs/manual-checks/empty-lists.md`); the writer still emits `{}` until the owner decides to switch. Windows CI is still open.

Goal: a tested server and library that find, read, normalise and safely write the plugin's `config.json`, evaluate rules with the plugin's real Lua, and expose it all through a locked-down local API. No UI, no packaging.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| JSON format on write | Detect the existing file's style (indent or compact) and re-emit it; 2-space pretty for a new file |
| Empty lists | Keep writing `{}` exactly as the plugin does, until `[]` is verified in the real app. This replaces the "write `[]`" line in `docs/CONTRACT.md` section 2 for now |
| Conflict (409) | Three-way auto-merge when the plugin's changes and the user's edits touch different items/fields, with a report of what merged; otherwise 409 with both versions |
| Backups | `config.json.bak-<timestamp>` next to the file, newest 20 kept |
| Token delivery | Server prints `http://127.0.0.1:PORT/#<token>`; the page reads the fragment and sends it in a header on every call; no cookies, not injected into HTML |
| App settings | OS profile dir: macOS `~/Library/Application Support/auto-reply-web/`, Windows `%APPDATA%\auto-reply-web\` |
| Missing config | A "create default config" endpoint, only on explicit request, using the plugin's defaults from the vendored `config.lua` |
| Manual check | The owner tests `[]` lists in the real Leafyrino early in the phase (steps below) |

## Layout
```
src/shared/   types, normalise/merge, JSON style, no I/O (runs in server, tests and browser)
src/server/   discovery, file store (backup, atomic write, hash/mtime), app settings, HTTP API, entry point
src/lua/      wasmoon host: loads vendor/plugin/*.lua + c2/json shim, runs in a Web Worker with timeout
tests/        unit + contract tests (Vitest), fixtures/ synthetic only
```
Stack from ADR 0001: TypeScript, Bun (server and compile), Vitest. Decided at the start of the phase and recorded in the ADR addendum: TypeScript version, `valibot` vs `zod` for the app's own data (proposal: valibot, smaller). Dependencies stay minimal and each gets a one-line reason.

## Steps (test first for every item, `test-driven-development` skill)
1. **Tooling.** Add TypeScript (strict), Vitest, `tests/` skeleton; wire into `pnpm lint`, `pnpm test`, `prepare.*` and CI. Fixtures: small synthetic configs for every case below (legacy `type/match` rules, timer `trigger`, `{}` lists, unknown keys, huge ids, Cyrillic names).
2. **Lua host + contract tests** (edge cases 5, 7). `wasmoon` loads the vendored `util`, `rules`, `names` and the `config.lua` sanitiser through the c2/json shim; wrapper runs in a worker with a timeout and a message API. Contract tests: the plugin's `unit_rules` cases (via `PLUGIN_REPO`, skipped when absent), names (1-20 chars, Cyrillic, reserved words, uniqueness), `parse_duration`, sanitiser output on synthetic fixtures. Extends the Phase 0 spike.
3. **Normalise and style** (edge case 3). `{}` to `[]` in memory, legacy shapes to the new shape, unknown keys kept; on write only edited items change and `{}` is kept for empty lists. Detect indent/compact and trailing newline. Property: round trip of every fixture is byte-stable.
4. **Ids and counters** (edge case 4). `next_*_id` never lowered, ids never reused after delete or reorder; array order is rule priority.
5. **Live state and merge** (edge case 2 and 1). Fields `active_until`, timer `started_at`/`game_id`/`enabled` always come from disk. Three-way merge by item id (base = the version the UI loaded, theirs = disk, mine = UI): disjoint changes merge, same-field changes return 409 with both versions. "Enable timer" sets `enabled=true, started_at=now`, no `game_id`, and reports the warning.
6. **File store** (edge cases 1, 10, 13, 15). Read with hash + mtime; backup before write (newest 20); temp file + atomic rename, retry with backoff for Windows sharing errors; invalid JSON opens read-only and is never overwritten (mirrors `config.json.bad`); target must be named `config.json`; config contents are never logged. Concurrency test: a simulated plugin save between load and write gives merge or 409, never data loss.
7. **Discovery and app settings** (edge case 11). Scan `*/Plugins/*/info.json` named "Auto Reply" under the OS roots, list candidates with plugin version and mtime, accept a typed path (name `config.json`, warn without sibling `info.json`); remember the choice in the profile-dir settings (including a first-run flag, nothing more). Handle Cyrillic user names and `%APPDATA%`; a missing file reports "missing" and offers create-default.
8. **Version gating** (edge case 9). Read `info.json` version, return the feature table from CONTRACT section 5; unknown newer fields preserved with a notice.
9. **HTTP API and security** (edge case 12). 127.0.0.1, random free port, Host check, token header on every call except serving the static page, no CORS, strict CSP, write only to the confirmed config and its backup/temp siblings, no external requests. Endpoints: discover, select path, load, save (with merge report), validate/evaluate through the Lua host, create default, backups list/restore. Entry point prints the token URL.
10. **Compile and smoke.** `bun build --compile` of the real entry point replaces the spike server in `pnpm build:smoke`; smoke starts the executable, discovers a synthetic config, saves, reads back. Spikes `server/` becomes unused and is deleted.
11. **Verify** with `verification-before-completion`, quoting fresh test, lint, build and CI output.

## Owner's manual check (early in the phase)
I will hand over a tiny test config with `[]` in `channels`, `ignore_users`, `protect_users`, `redeems` and a rule's `channels`, plus steps: put it in a copy of the plugin's `data/`, run `/autoreply reload`, run `/autoreply list` (or equivalent), check that nothing is dropped and no `config.json.bad` appears, then add one rule and compare the saved file. Your result goes into `docs/CONTRACT.md` (VERIFIED or still UNVERIFIED). Until then we write `{}`.

## Acceptance (from PLAN.md)
- Round trip of every sample config is byte-stable apart from intended edits.
- Concurrent-write test (simulated plugin save) yields merge or 409, not data loss.
- Security tests: wrong Host and missing/wrong token are rejected; writes outside the config are impossible.
- CI is green on Windows, macOS arm64 and macOS Intel, including the replace-while-open test (the Phase 0 UNVERIFIED item).

## Constraints I will keep
- Only Phase 1 is touched; no UI, no packaging, no onboarding.
- Plugin repo stays read-only; its private fixtures only through `PLUGIN_REPO`; no real logs or configs in this repo.
- No new third-party skills or agents without asking (`webapp-testing` is still deferred, it matters for the UI phases).
- No commit or push unless you ask; commits in logical pieces.

## Open points I will raise during the phase
- If Windows CI fails the smoke or replace-while-open test: switch the executable tool to Node SEA or adjust the write retry.
- If the plugin's `config.lua` sanitiser is hard to load without the rest of the plugin: ask whether to request the pure-module extraction from CONTRACT section 6 (a separate plugin change, your call).
