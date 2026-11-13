---
description: Re-run the vendored-plugin drift check and the contract tests
---

Run, in this order, and quote the fresh output:
1. `pnpm sync-plugin:check` (vendored files match `vendor/plugin/VERSION.json`).
2. If the plugin repo is reachable (`PLUGIN_REPO` or `../auto-reply-plugin`): `pnpm sync-plugin` into a clean tree and `git diff --stat vendor/plugin/` to see whether the plugin moved on. Report differences; do not commit them.
3. `pnpm test` (contract tests against the vendored Lua once they exist).

If anything differs, tell the owner what changed in the plugin version and which contract sections (`docs/CONTRACT.md`) may need updating. The plugin repo is read-only.
