# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver, tags are `vX.Y.Z`.

## [Unreleased]
- Direction change: hosted static site on Vercel. Removed the executable build, bundles, release pipeline, tab lifecycle, browser opener and `release-check`; added `pnpm dev` / `pnpm preview` / `pnpm build`, `vercel.json` and shared security headers. The local API server stays dormant until the browser file layer (Phase 2b) replaces it.
- Phase 0: repository environment, vendoring script, stack spikes, prepare scripts, CI skeleton.
- Phase 1: config model (normalise, minimal-diff render, JSON style detection), id counters, three-way merge with live-state protection, safe file store (backup, atomic write, retry), discovery, app settings, version gating, WASM Lua host with worker timeout, local HTTP API with Host/token/Origin checks, compiled-binary smoke test.
- Phase 2: Russian dark UI served by the executable (shell, sidebar, save bar, reload banner, config picker, history/restore, per-field conflict dialog, Settings page), session store with undo/redo, tab lifecycle (opens the browser, exits with the last tab), Playwright e2e and accessibility checks.
