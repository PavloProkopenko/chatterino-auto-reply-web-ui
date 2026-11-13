# Auto Reply Web

A local web UI for the **Auto Reply** plugin for Leafyrino (a Chatterino fork). It edits the plugin's `data/config.json`; the plugin keeps working without this app. UI language: Russian. Status: Phase 1 (core server and library) done, no UI yet. See `PLAN.md`, `docs/CONTRACT.md` and `docs/adr/`.

## Develop

Needs `curl`, `tar` (macOS) or PowerShell 5+ (Windows). No admin rights, nothing is installed system-wide.

```sh
scripts/prepare.sh            # macOS: portable Node + pnpm in .tools/, install, lint, tests, vendor check, build smoke
scripts/prepare.sh --check    # only report what is missing
```
```powershell
scripts\prepare.ps1           # Windows
scripts\prepare.ps1 -Check
```

Afterwards (the script prints the exact line):

```sh
export PATH="$PWD/.tools/node/bin:$PWD/.tools/pnpm/node_modules/.bin:$PATH"
pnpm lint && pnpm typecheck && pnpm test && pnpm sync-plugin:check && pnpm build:smoke
```

`pnpm sync-plugin` copies the plugin's Lua modules from `../auto-reply-plugin` (or `$PLUGIN_REPO`) into `vendor/plugin/` and records hashes; the plugin repo is only read.

## Releases
Tags are `vX.Y.Z`; the version source of truth is `package.json`; changes are listed in `CHANGELOG.md`. The release workflow arrives in Phase 6.

## Licence
Undecided, see `LICENSE`.
