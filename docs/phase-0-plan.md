# Phase 0 plan: environment (no product code)

Status: **done** (owner approved the plan and the stack ADR on 2026-11-13). Windows, Intel-macOS-in-CI and in-browser checks remain UNVERIFIED, see the ADR.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| Server / single executable spike | Bun (`bun build --compile`) vs Node SEA |
| UI spike | Svelte vs React, same small sample in both |
| Package manager | **pnpm** (pinned, bootstrapped by the prepare scripts without admin rights) |
| Licence | Placeholder `LICENSE` stating "undecided"; no rights granted yet |
| Agents | Core four now: `architect`, `backend-dev`, `frontend-dev`, `qa-tester`. `security-reviewer`, `release-engineer`, `docs-writer` come when their phases start |
| CI | Write `.github/workflows/ci.yml`; do not push |
| Spike input | Real plugin Lua, copied read-only from `../auto-reply-plugin/auto-reply/` into `vendor/plugin/` by `scripts/sync-plugin` |

## Steps (in order)
1. **Repo skeleton.** `README.md` skeleton, `LICENSE` placeholder, `.gitignore` check (`.tools/`, `node_modules/`, `spikes/*/dist`, `dist/`), `package.json` with `packageManager` pinned to pnpm, `CHANGELOG.md` stub, version/tag convention `vX.Y.Z` noted in README.
2. **Vendoring script** `scripts/sync-plugin` (Node): copies `util.lua`, `rules.lua`, `names.lua` and the sanitiser part of `config.lua` into `vendor/plugin/`, writes `vendor/plugin/VERSION.json` (plugin version from `info.json` + SHA-256 per file). A `--check` mode fails on drift. Plugin repo is only read.
3. **Spike A, Lua in the browser** (`spikes/lua-wasm/`): `wasmoon` loads the vendored files with a small `c2`/`json` shim.
   - Pass criteria: Cyrillic matching and lower-casing are correct; `rules.matches_one` equals the system `lua` on the table in the plugin's `tests/cases/unit_rules.lua` (read through `PLUGIN_REPO`, not copied); a catastrophic Lua pattern in a Web Worker is stopped by a timeout without freezing the page.
   - Record load time and bundle size. Fallback `fengari` only if wasmoon fails.
4. **Spike B, server + executable** (`spikes/server/`): a 127.0.0.1 server on a random port that serves one static page, a JSON endpoint with Host + token check, and an atomic write (temp file + rename).
   - Build with Bun and with Node SEA. Targets: Windows x64, macOS arm64, macOS x64.
   - Compare: working binary without a runtime on the target, size, build time, cross-compile support, Windows replace-while-open behaviour.
   - **Limit:** this Mac can only run the macOS arm64 result. Windows and Intel results are verified in CI (`windows-latest`, an Intel macOS runner) or marked UNVERIFIED in the ADR.
5. **Spike C, UI stack** (`spikes/ui-svelte/`; the React sample was built and measured, then removed after the decision): a rule list with drag-and-drop reorder, a condition form, keyboard reorder, and a Russian string from a dictionary module.
   - Compare: bundle size, drag-and-drop ergonomics, accessibility, available component kit.
6. **ADR** `docs/adr/0001-stack.md`: the choices, evidence from each spike (pass/fail, numbers), rejected options, a reason for each dependency, and what stays UNVERIFIED.
7. **Prepare scripts** `scripts/prepare.sh` and `scripts/prepare.ps1`: idempotent, no admin rights, pinned portable Node and pnpm in `./.tools/` with SHA-256 checks, `pnpm install --frozen-lockfile`, then lint, unit tests and a build smoke test, then print the next command. `--check` only reports what is missing.
   - Only the `.sh` can be run on this Mac. The `.ps1` is reviewed by reading and run in CI on Windows.
8. **SDLC files.** Four agents in `.claude/agents/` (role, tools, definition of done) and four project commands `/adr`, `/spike`, `/contract-check`, `/release-check`. Update `docs/sdlc.md` and `CLAUDE.md` (test/build commands, once they exist).
9. **CI skeleton** `.github/workflows/ci.yml`: lint, unit tests, `sync-plugin --check`, build smoke on `windows-latest` and macOS. Third-party actions pinned by commit SHA, `permissions: contents: read`.
10. **Verify** with the `verification-before-completion` skill: run `scripts/prepare.sh` on a clean checkout and show the green output.

## Acceptance (from PLAN.md)
- A fresh clone plus `scripts/prepare.*` reaches green lint, tests and build smoke on this Mac.
- ADR 0001 is written with spike evidence.
- Agents and skills are documented in `docs/sdlc.md`.

## Constraints I will keep
- Spike code is throw-away and lives only in `spikes/`; TDD applies from Phase 1.
- No third-party skills or agents are installed without asking. `webapp-testing` is still deferred to Phase 1.
- No real chat logs or customer configs enter the repo. Plugin test material is read only through `PLUGIN_REPO`.
- No commit or push unless you ask.

## Open points I will raise during the phase, not now
- Whether `fengari` is needed (only if wasmoon fails).
- If the Intel macOS or Windows binary can't be verified in CI yet, whether to accept that for the ADR.
