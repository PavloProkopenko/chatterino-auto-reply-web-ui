# Manual check: does the plugin accept `[]` for empty lists?

Why: the plugin itself writes empty lists as `{}`. The web app writes `{}` too until this check is done (Phase 1 plan). If the real Leafyrino accepts `[]`, we can write clean JSON.
The result is recorded below and in `docs/CONTRACT.md` section 2. This touches your plugin data, so back up your own `config.json` first (step 1).

## Steps
1. Leave Leafyrino running, but first **copy** your real `Plugins/<Auto Reply folder>/data/config.json` to a safe place (for example `config.json.mine`).
2. Replace `data/config.json` with `docs/manual-checks/empty-lists.config.json` from this repo (synthetic: one rule, every list written as `[]`, including the rule's `channels`, `ignore_users`, `protect_users`, `timers`, `redeems`).
3. In Leafyrino run `/autoreply reload`.
4. Run `/autoreply list`, `/autoreply timer list`, `/autoreply redeem list`, `/autoreply status`.
5. Look in `data/`: is there a new `config.json.bad`?
6. Add something with a command, for example `/autoreply ignore add testuser` (or any small change), then open `data/config.json` and note how the empty lists are written now (`{}` or `[]`) and whether the rule "проверка" is still there.
7. Put your own `config.json` back (the copy from step 1) and run `/autoreply reload`.

## Result (2026-11-14, reported by the owner)
Build: Leafyrino Nightly 2.5.5 (commit 000929481, built 2026-10-17, Qt 6.9.3), macOS 27.3 (kernel 27.3.0).

| Question | Answer |
|---|---|
| `/autoreply list` shows the rule "проверка" (not dropped or disabled)? | Yes |
| Warning in the chat window after reload? | No |
| `config.json.bad` appeared? | No |
| After a change made with a command, empty lists in the saved file | Written as arrays (`[]`) |

Conclusion: **VERIFIED on this build: the plugin loads `[]` for the empty list fields.** In this build the plugin's own save also wrote arrays. UNVERIFIED: older Chatterino builds and Windows; the exact lines of the saved file were described, not pasted.
