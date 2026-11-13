---
description: Pre-release checklist (dry run, nothing is published)
---

Check and report each item with evidence; do not tag, push or publish:
1. `package.json` version, `CHANGELOG.md` section for it, and the planned tag `vX.Y.Z` agree.
2. `scripts/prepare.sh --ci` is green (lint, tests, vendor check, build smoke).
3. `vendor/plugin/VERSION.json` matches the vendored files; the minimum supported plugin version is stated in the release notes.
4. Bundles for Windows x64, macOS arm64 and macOS x64 exist and each passed the e2e smoke (mark any not run as UNVERIFIED).
5. `docs/customer-ru.md` covers SmartScreen/Gatekeeper and the `/autoreply reload` step.
6. No real chat logs, customer configs or backups are tracked (`git ls-files | grep -iE 'config|\.log|\.bak'`).
Release workflow details: `PLAN.md` section 4a (implemented in Phase 6).
