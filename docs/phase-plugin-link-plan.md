# Phase: whole-plugin link, install and update from the site

Status: implemented on the dev Mac (plugin 0.6.1). Decisions by the owner (2026-11-14): the whole-plugin link replaces the data-only link; the site installs and updates the plugin; "update" overwrites Lua source (no build); files are bundled in the site (no network); first install = the site writes an empty folder, then the user links it once; old code is backed up before an update. Not wanted: hash re-verification after writing, reload instructions in the UI, blocking updates while the session has unsaved edits.

## What was built
- `scripts/sync-plugin.mjs`: vendors every top-level `*.lua` plus `info.json` (never `data/`, `tests/`); `--check` also fails on a plugin file that is not vendored.
- `src/ui/data/plugin-install.ts` (+ `plugin-bundle.ts`, `PluginDir` port, `folderPluginDir` in `fs-access.ts`): `inspectPlugin` (missing/foreign/current/older/newer/modified), `installPlugin`, `updatePlugin` (backup first, info.json written last), `listPluginBackups`, `rollbackPlugin`.
- UI: `PluginCard` = `components/PluginPanel.svelte` in Settings (open folder) and on the welcome screen (install into a chosen folder, then open it); link helper with `linkCommand` in `state/place.ts`.
- `scripts/link-config.*` / `unlink-config.*` for the whole folder; backups go outside `Plugins`.

## Tests
`tests/data/plugin-install.test.ts` (in-memory folder), `tests/ui/place.test.ts` (link command), `scripts/sync-plugin.test.mjs`, `scripts/link-config.test.mjs` (real shell script, stubbed `pgrep`), `tests/e2e/plugin.spec.ts` (OPFS folder).

## UNVERIFIED
Windows junction scripts; the real Chrome folder picker on a folder inside Documents; Leafyrino picking up new code after a restart (check `/autoreply status` after an update).
