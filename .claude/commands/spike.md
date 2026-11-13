---
description: Run a throw-away spike in spikes/<name>/ with an explicit pass/fail result
argument-hint: <name> <question to answer>
---

Spike: $ARGUMENTS

1. State the question and the pass/fail criteria before writing code.
2. Put throw-away code only in `spikes/<name>/` (own `package.json`, not part of the workspace; `node_modules/` and `dist/` are gitignored).
3. Run it, record numbers (size, time, results) and mark anything you could not run on this machine as UNVERIFIED.
4. Summarise the outcome for the ADR. Do not reuse spike code as product code; product code starts with a failing test.
