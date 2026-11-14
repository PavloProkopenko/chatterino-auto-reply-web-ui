# ADR 0001: Stack

Status: **accepted** (owner confirmed 2026-11-13)
Date: 2026-11-13

## Context
Auto Reply Web is a local app: a small server on 127.0.0.1 plus a browser UI that edits the plugin's `config.json` (see `PLAN.md`, `docs/CONTRACT.md`). Customers get a portable bundle with nothing to install (Windows x64, macOS arm64/x64). Rule evaluation must be the plugin's real Lua.

Spikes are in `spikes/` (throw-away, not product code). Machine: macOS arm64 dev Mac, Node 22.17, Lua 5.5.1 CLI. Anything not run on Windows or in a real browser is marked **UNVERIFIED**.

## Spike A: Lua in the browser (`spikes/lua-wasm`; its code now lives in `src/lua/`) - PASS
`wasmoon` 1.16.0 (Lua 5.4 in WASM) loads the vendored `util.lua` and `rules.lua` with a small `c2` shim (`shim.lua`).
- The 25 cases of the plugin's `tests/cases/unit_rules.lua` (read through `PLUGIN_REPO`, not copied): 25/25 match the expected table, and the output is identical to the system `lua` (5.5.1) run. Cyrillic case folding, word edges (`играет2`, `играет-то`) and the invisible anti-duplicate suffix pass.
- Speed: engine creation 13 ms, running all 25 cases 1.9 ms.
- Size: `index.js` 152 kB (39 kB gzip), `glue.wasm` 271 kB (111 kB gzip).
- Catastrophic Lua pattern (`a-a-a-a-a-a-a-a-a-a-b` on 200 `a`): a worker is terminated after the 1.5 s timeout and the main thread keeps running (29 ticks of a 50 ms timer). A bad pattern (`[`) returns `false` from `pcall`, no throw.
- UNVERIFIED: the same worker-timeout behaviour in a real browser `Worker` (tested with Node `worker_threads`); `names.lua` and `config.lua` sanitiser (only `util` + `rules` were loaded, the rest comes with the contract tests in Phase 1).
- `fengari` fallback not needed.

## Spike B: server + single executable (the spike code was replaced by the real server in Phase 1; Node SEA config removed)
A server with Host check, per-session token, CSP header and atomic write (temp file + rename). The same smoke test (page, bad Host -> 421, no token -> 403, ping, write + read back with Cyrillic content) passes on every runnable binary.

| | Bun 1.4.4 `build --compile` | Node SEA (22.17, esbuild + postject) |
|---|---|---|
| macOS arm64 binary | 89 MB, smoke PASS | 110 MB, smoke PASS (needs `codesign --remove-signature`, inject, `codesign --sign -`) |
| macOS x64 binary | 98 MB, smoke PASS under Rosetta | not built (needs the darwin-x64 Node binary) |
| Windows x64 binary | 115 MB `.exe` built from this Mac, **not run** (UNVERIFIED, CI) | not built (needs `node.exe` + postject on Windows) |
| Build time | 1-2 s per target, all three from one host | seconds per target, but one host per OS |
| Steps | one command | bundle to CJS, SEA blob, copy node, strip signature, inject, re-sign |

UNVERIFIED for both: atomic replace while another process (Chatterino) holds the file on Windows. `renameSync` semantics on Windows are the same libuv/MoveFileEx family in both runtimes, so the retry-with-backoff from `PLAN.md` edge case 13 is needed either way and is a Phase 1 test.

## Spike C: UI stack (`spikes/ui-svelte` is kept; the React sample was removed after the decision)
The same sample in both: sortable rule list, name input, type select, up/down buttons, Russian strings from a dictionary module.

| | React 19 + dnd-kit | Svelte 5 + svelte-dnd-action |
|---|---|---|
| Production JS (Vite 8) | 266 kB (84 kB gzip) | 79 kB (28 kB gzip) |
| Reorder | pointer + keyboard sensors, built-in announcements | pointer + keyboard + aria-live; explicit up/down buttons in both |
| Forms | controlled inputs, `useState` | `bind:value` on `$state` |
| Ecosystem | larger (shadcn/ui, Radix) | smaller (bits-ui, shadcn-svelte) |

UNVERIFIED: drag behaviour and screen-reader output were not exercised in a browser (Playwright is set up in Phase 1).

## Decision
- **Server and executable: Bun** (`bun build --compile`, targets `bun-windows-x64`, `bun-darwin-arm64`, `bun-darwin-x64`). Reason: three targets from one command and one host, smaller binaries. Node SEA stays the fallback if a Windows CI run fails the smoke test or the replace-while-open test.
- **UI: Svelte 5 + Vite + TypeScript**, drag and drop with `svelte-dnd-action`, always with explicit up/down buttons. Reason: 3x smaller bundle and simpler form code for a form-heavy app. Trade-off: fewer ready-made accessible components than React; decide on a component kit (bits-ui or plain CSS) in Phase 2.
- **Lua: `wasmoon`**, in a Web Worker with a timeout.
- **Package manager: pnpm 12.18.0**, installed by the prepare scripts with `npm install --prefix .tools/pnpm` (corepack 0.33 cannot launch pnpm 12's native binary: `Cannot find module .../pnpm.cjs`). Lockfile is committed; installs use `--frozen-lockfile`. pnpm's release-age policy and build-script allow-list live in `pnpm-workspace.yaml`.
- **Tests: `node:test` for scripts now; Vitest (unit) and Playwright (e2e on the built executable) from Phase 1.** Not spiked: UNVERIFIED until Phase 1.
- Validation of the app's own data (`zod` or `valibot`) and TypeScript version: decided at the start of Phase 1.

## Dependencies (root `package.json`)
| Package | Reason |
|---|---|
| `bun` 1.4.4 | compiles the single executable; also runs the build smoke test |
| `eslint` 10.15.0, `@eslint/js`, `globals` | lint of scripts and (later) source |

Spike-only dependencies (`wasmoon`, `svelte`, `svelte-dnd-action`, `vite`) live in each spike's own `package.json` and are not shipped. Compared and dropped: React + dnd-kit, Node SEA (`postject`, `esbuild`).

## Consequences
- Phase 1 starts with the contract tests for `names.lua` and the `config.lua` sanitiser through wasmoon, and a Windows replace-while-open test in CI.
- `scripts/prepare.*` and CI use the pinned toolchain; Windows results appear only after the first CI run.

## Addendum (Phase 1 start, 2026-11-14)
- **TypeScript 6.0.3**, not 7.0.2: `typescript-eslint` 8.72.2 declares `typescript >=4.8.4 <6.1.0`, and lint needs it. Revisit when typescript-eslint supports 7.
- **valibot 1.5.0** validates the app's own data (settings file, API request bodies). Plugin config content is not schema-validated by the server: the plugin's Lua is the validator.
- **Vitest 5.1.0** for unit and contract tests; `node:test` stays for the scripts folder.
- **Lua runs only in the browser/worker**, as the architecture says; the server has no Lua endpoint. The in-repo `src/lua/` host is exercised by contract tests in Node through the same code.
- Dependencies added: `wasmoon` (Lua 5.4 in WASM), `valibot`, `typescript`, `typescript-eslint`, `vitest`, `@types/node`.

## Addendum (Phase 2, 2026-11-14)
- **UI embedding:** `scripts/build-ui.mjs` runs Vite and writes `src/server/assets.generated.ts` (gitignored; base64 assets); the server serves it and `bun build --compile` embeds it. Everything the page needs (JS, CSS, the Lua worker, `glue.wasm`) is same-origin, so the strict CSP stays: no inline scripts, `<style>` or `style=""`, no Svelte transitions (they inject `<style>`), plain CSS transitions instead.
- **Lifecycle:** each tab has an id and sends a heartbeat every 10 s and a `bye` (keepalive fetch) on `pagehide`. The app exits 10 s after the last tab is gone, 3 min after a tab goes silent, or 60 s after start if no tab ever connects. `AUTO_REPLY_WEB_NO_EXIT=1` / `AUTO_REPLY_WEB_NO_BROWSER=1` disable exit and browser opening for development and tests.
- **Token handling:** the page reads the token from the URL fragment, keeps it in `sessionStorage` (so a reload works) and removes it from the address bar.
- **State:** `Session` (Svelte 5 runes in a `.svelte.ts` module, tested with Vitest through the Svelte plugin) owns load/edit/undo/save/conflict logic. `mergeConfigs` gained per-conflict `resolutions`; after the user's choices the UI rebases onto the plugin's version, so stale live state is never written.
- **Validation:** names are checked by the plugin's own `util.parse_channels` / `util.parse_skip` in the Lua worker. Cooldown ranges (0-86400, `gap` >= 1) are copied from `/autoreply set` in `commands.lua`, which is not vendored: UI limit.
- **e2e:** Playwright on a compiled executable built with `VITE_E2E=1` (it exposes the Lua client as `window.__e2e` for tests; the production build does not). The browser lives in `.tools/browsers`. `@axe-core/playwright` runs automated WCAG 2 A/AA checks in the same run.
- Dependencies added: `svelte`, `vite`, `@sveltejs/vite-plugin-svelte` (the UI, per this ADR), `svelte-check` (types for `.svelte`), `@playwright/test` (real-browser e2e), `@axe-core/playwright` (accessibility checks in e2e).
- `webapp-testing` skill reviewed and **not installed**: Python Playwright helpers built around a fixed-port dev server (`with_server.py` uses `shell=True`); this project already has a TypeScript suite that starts the real executable on a random port with a token.
- Closed: the worker timeout now has a real-browser test (Chromium, macOS). Still UNVERIFIED: Windows, Intel macOS, Firefox/Safari.

## Addendum (2026-11-14): hosted static site; the executable decision is superseded
The owner moved from a local app to a static site on Vercel (`PLAN.md` section 0a). Consequences for this ADR:
- **Superseded:** Bun `build --compile`, the single-file executable, portable bundles, the Windows/macOS packaging concerns, Node/Bun toolchain downloads for customers, the tab-lifecycle exit logic, the browser opener. `bun` is no longer a dependency.
- **Unchanged:** Svelte 5 + Vite + TypeScript, `wasmoon` in a Web Worker, pnpm, Vitest, Playwright, valibot. The UI keeps its strict CSP; headers now come from `src/shared/security-headers.ts`, mirrored in `vercel.json` (a test keeps them equal).
- **Dormant:** `src/server/` stays in the repo for the dev stack (`scripts/devstack.ts` puts it behind Vite so the UI has data) and its own tests, until the browser file layer replaces it in the UI.
- **TypeScript rule:** `erasableSyntaxOnly` is on, so Node can run `.ts` files directly (`node --experimental-strip-types`), which the dev stack and the e2e harness do.
- **e2e:** `pnpm test:e2e` builds `dist-e2e` (`--mode e2e`, adds the `window.__e2e` seam) and runs Playwright against `vite preview` with the production headers.
- **UNVERIFIED:** pnpm 12 on Vercel's build image (`vercel.json` installs it with npm; corepack cannot start pnpm 12); the File System Access API behaviour on the real plugin folder (Phase 2b).
