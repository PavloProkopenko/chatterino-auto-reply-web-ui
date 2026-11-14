# Auto Reply Web

A web UI for the **Auto Reply** plugin for Leafyrino (a Chatterino fork). It is a static site (hosted on Vercel): the user opens a URL, picks the plugin's `config.json`, edits it in the browser and saves; nothing is uploaded anywhere. The plugin keeps working without it. UI language: Russian. Status: Phases 0-2 and the browser file layer (2b) done; Rules, Timers and Redeems pages come next. See `PLAN.md` (section 0a), `docs/CONTRACT.md` and `docs/adr/`.

## Develop

Needs Node >= 22. `scripts/prepare.sh` installs a pinned pnpm into `.tools/` and runs every check.

```sh
scripts/prepare.sh            # install, lint, typecheck, tests, vendor check, build, e2e
scripts/prepare.sh --check    # only report what is missing
scripts/prepare.sh --no-e2e   # skip the browser download and the Playwright run
```

Then (the script prints the exact PATH line):

```sh
export PATH="$PWD/.tools/pnpm/node_modules/.bin:$PATH"
pnpm dev        # Vite dev server with hot reload; use "Попробовать на примере" (demo) or pick a real plugin folder in Chrome/Edge
pnpm preview    # the production build with the production security headers
pnpm build      # output in dist/ (what Vercel deploys)
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

`pnpm sync-plugin` copies the plugin's Lua modules from `../auto-reply-plugin` (or `$PLUGIN_REPO`) into `vendor/plugin/` and records hashes; the plugin repo is only read.

## External plugin folder

Browsers can't write into Leafyrino's app-data folder, so the plugin folder can be made a link to a folder you pick (for example in Documents). The site then opens that folder, edits `data/config.json`, and can install or update the plugin files in it (bundled with `pnpm sync-plugin`; a plugin release means re-vendor and redeploy). Two ways to create the link, with Leafyrino closed: the command the site shows (Plugin card), or `scripts/link-config.sh <folder>` (macOS/Linux) / `scripts/link-config.ps1 -Target <folder>` (Windows, untested), which also copies your current plugin folder (the original is kept in `auto-reply-backups` next to `Plugins`). Undo with `unlink-config.*`. See `docs/CONTRACT.md` §2.

## Deploy
Vercel builds with `pnpm build` and serves `dist` (see `vercel.json`, which also sets the security headers; tests keep it in sync with the code). Nothing else is released or shipped.

## Licence
Undecided, see `LICENSE`.
