# Contract with the Auto Reply plugin

Everything here was verified against the plugin source in `../auto-reply-plugin/auto-reply/` (plugin v0.5.0) unless marked UNVERIFIED. The web app is a **separate, optional project**: the plugin must keep working with no knowledge of it. The only interface is the plugin's `data/config.json`.

## 1. Where the file lives
`<app data dir>/Plugins/<plugin folder>/data/config.json`, next to `<plugin folder>/info.json` (`"name": "Auto Reply"`, `"version": "x.y.z"`).
- macOS: `~/Library/Application Support/<app folder>/Plugins/...` — seen on the dev Mac: `chatterino`, `Chatterino by Mist1X`.
- Windows: `%APPDATA%\<app folder>\Plugins\...` (stock folder `Chatterino`; leafyrino's may differ).
- Linux: `~/.local/share/<app folder>/Plugins/...`.
- The app folder and the plugin folder name vary, so **detect by content**: scan one level under the roots above for `*/Plugins/*/info.json` whose `name` is `Auto Reply`, then use its `data/config.json`. Several matches (stock + fork) are possible: let the user pick. `data/` may not exist yet or `config.json` may be absent (plugin never ran): offer "create default config".
- Fallback: user types/browses a path to a `config.json`. Accept only a file named `config.json`; show a warning if no sibling `../info.json` with name `Auto Reply` exists.

## 2. File semantics (these drive every edge case)
- The plugin reads the file **only** at start/reload (`/autoreply reload`, which also resets a session-only "on"). It **rewrites the whole file on every change** it makes (`/autoreply ...` commands, timer start/stop, category change). A UI write while the app runs can be overwritten by the next plugin save, and is not seen until `/autoreply reload`. Decision: **UI writes, then tells the user to run `/autoreply reload`**; the UI detects external changes by content hash + mtime, always keeps a backup, writes atomically (temp file + rename). Never edit live-state fields (below).
- **External plugin folder (plugin 0.6.1, VERIFIED on macOS 2026-11-14 for a link on `data/` and on the whole plugin folder):** the plugin folder in Leafyrino's `Plugins` may be a symlink (macOS/Linux) or junction (Windows, UNVERIFIED) to a user-chosen folder. leafyrino lists plugins with `QDir::Dirs` (follows links) and only checks `io.open` paths as text against `<plugin>/data/`, so it follows the link. This replaced the data-only link. The linked folder is the whole plugin: code files, `info.json`, `data/config.json` and a `data/.external` marker (read by the plugin's `/autoreply status`, a heuristic). The site opens that folder through the File System Access API (not a system folder, so Chrome allows it), edits `data/config.json` as before, and can install or update the plugin's own files (every top-level `*.lua` plus `info.json`, bundled in the site by `pnpm sync-plugin`, never `tests/`).
  - Update = overwrite the bundled files after copying the current code files to `.backup/<old version>/` (with a `backup.json`); never touches `data/`, `.backup/`, subfolders or unknown files; rollback restores the newest backup after backing up the current code. The plugin loads its code only at app start, so a new version takes effect after restarting Leafyrino (`/autoreply reload` rereads config only).
  - `scripts/link-config.sh|ps1` create the link (copying the existing plugin folder; the original goes to `<app data>/auto-reply-backups/`, never next to it inside `Plugins`: Leafyrino loads every folder there, a leftover copy would register the plugin twice); `unlink-config.*` undo it. The site also shows a copy-paste `ln -s` / `mklink /J` command (paths typed by the user; unsafe characters are refused, not escaped).
  - Plugin-side paths outside the plugin folder stay impossible (no plugin settings UI, `io.open` is sandboxed).
- Plugin 0.7.0+ polls `data/config.json` every ~3 s and adopts external changes (file wins for rules/settings; live state is kept unless the file changed it), so no `/autoreply reload` is needed; older plugins read the file only on `/autoreply reload`. No network. After the site replaces the plugin's code it writes the new version to `data/.plugin-update`; plugin 0.7.2+ compares it with its running version and tells the user in chat to restart the plugin (Settings, Plugins) until they match. There is no Lua API to reload a plugin.
- JSON serializer quirk: some builds write an **empty list as `{}`** (`"channels": {}`, `"ignore_users": {}`, `"redeems": {}` and `rules[].channels: {}`), so the reader must treat `{}` as an empty list for all list fields. VERIFIED 2026-11-14 on Leafyrino Nightly 2.5.5 (macOS, `docs/manual-checks/empty-lists.md`): `[]` is accepted on load for those fields with no warning and no `config.json.bad`, and the plugin's own next save wrote arrays. UNVERIFIED: other builds and Windows. **The web app still writes `{}` for lists it empties and keeps whatever the file already had for untouched lists**; switching to `[]` is the owner's decision (see `docs/phase-1-plan.md`).
- Unknown keys must be **preserved** on round trip (newer plugin versions add fields). Key order is irrelevant.
- `config.load` sanitises silently (drops invalid timers/redeems/names, disables rules with unusable channels and timers with unusable conditions (it does **not** validate rule conditions or replies: such a rule is kept and simply never matches; it also forces `enabled=false` on a timer without a numeric `started_at` and drops a redeem without a title or with a duration outside 1 s to 14 d; checked on the vendored 0.5.0 `config.lua`), corrupt file is backed up as `config.json.bad`). The UI should show what the plugin would drop, not hide it.

## 3. Schema (v1, plugin 0.5.0)
Global: `version` (1), `active_until` (nil | `"forever"` | unix seconds; **live state, do not edit**), `channels[]` (logins), `ignore_users[]`, `protect_users[]`, `unprotect_users[]` (plugin 0.9.0: logins that MAY be muted although a mod badge, `protect_users` or the bot list would protect them; the channel owner and the account itself are always protected), `per_user_cooldown` (s, default 60), `per_rule_cooldown` (10), `global_min_gap` (>= 1, default 2), `only_when_live` (bool), `skip_mods` (bool, default false), `mute_lurkers` (bool, false), `backfire` (bool, true), `helix_enabled` (bool, false; opt-in Twitch API, set in chat with `set helix on`; the token lives in `data/helix.json`, never in config.json), `next_rule_id`, `next_timer_id`, `next_redeem_id` (ids are never reused: the UI must keep these counters correct).

`rules[]`: `{ id, name?, enabled, reply, channels[] (empty = all channels), conditions[{type, match?}], skip_mods? (true|false|absent = follow global), skip_users[]? }`. Legacy: `type`/`match` directly on the rule = one condition (`rules.conditions`). Order matters: **first matching rule wins**.

`timers[]`: `{ id, name?, channel, reply, format ("smart"|"full"), on_category ("reset"|"stop"|"off"), conditions[] (legacy: single-word `trigger` = one `word` condition), skip_mods?, skip_users[]?, enabled, started_at, game_id }`. `enabled`, `started_at`, `game_id` are **live state**: the plugin sets them when a timer starts. All timers are checked before rules. Reply must contain `{time}`.

`redeems[]`: `{ id, name?, channel, title, action ("timeout"|"untimeout"), seconds? (timeout only, 1..1209600), enabled }`.

Condition `type`: `keyword` (substring), `word` (whole word/phrase), `anyword` (`a|b|c`, each a whole word), `mention` (no `match`), `flag` (`match` in `first highlighted reply announcement sub cheer`), `pattern` (Lua pattern), `noword` (since plugin 0.10.0: `a|b|c`, true when NONE of them is in the message as a whole word; a condition list needs at least one non-`noword` condition, `rules.validate_set`; a `noword`-only item never fires). Conditions of one item are ANDed (the plugin's chat syntax joins them with ` + `); there is no OR inside an item (use two rules).

### 3a. `data/helix.json` (plugin 0.8.0+): the Twitch login
Not part of `config.json`. Keys: `client_id`, `access_token`, `refresh_token`, `expires_at` (unix s), `user_id`, `login`, `scopes[]`. **Owner: the plugin** (it refreshes tokens, which Twitch rotates, and rewrites the file). The site writes it only on login (all keys, unknown keys kept) and on logout (token and account keys removed, `client_id` kept; the token is revoked at Twitch). The UI may show only who is logged in; the token is never held in UI state, logged, shown, backed up or put in an error message. Plugin >= 0.8.2 re-reads the file while running; older plugins only at start. `helix_enabled` (bool, default false) in `config.json` is the opt-in switch.

## 4. Validation rules the UI must honour (do not re-implement: run the plugin's Lua, see PLAN.md)
- Reply (rules and timers): non-empty, <= 500 **bytes** (`#reply` in Lua: a Cyrillic letter is 2 bytes, so about 250 letters), must not start with `/` or `.`; timers also need `{time}`. Placeholders: `{user}` (sender), `{time}` (timers). The check lives in `engine.lua` (`E.check_reply`), which is not pure; see "Recommended plugin change" below.
- `rules.validate(type, match)`, `names.valid/check/find` (1-20 chars, letters incl. Cyrillic/digits/`_`/`-`, at least one letter, unique per kind, case-insensitive, not a reserved command word — list in `names.lua`), `util.parse_duration` (`30m`, `1h30m`), `util.parse_channels`, `util.parse_skip`.
- Matching semantics: custom Unicode lower-casing (Latin + Cyrillic incl. Ukrainian); word characters are ASCII letters, digits, `_` and every byte >= 128 (so `играет2` is not `играет`); `mention` needs the account login.
- Chat-side limits worth surfacing: send rate limiting drops fast messages; replies are sent with `execute_commands=false`; per-user/per-rule cooldowns and `global_min_gap` apply; a rule bound to a channel that is not in `channels` is dormant.

## 4a. Number ranges for settings
`per_user_cooldown`, `per_rule_cooldown`, `global_min_gap`: whole seconds 0..86400, and `global_min_gap` at least 1 ("Twitch limits"). Source: `/autoreply set` in `commands.lua` (`cmd_set`); the config loader itself only resets negative or non-numeric values. The UI copies these limits (that function is not vendored).

## 5. Version gating (read `info.json` version)
| Feature | Plugin version |
|---|---|
| names on rules/timers/redeems | 0.2.1 |
| rule channel scope (`channels`) | 0.3.0 |
| timer conditions (`conditions[]`, `=>` syntax) | 0.4.0 |
| `skip_mods` / `skip_users` | 0.5.0 |
| Twitch API (`helix_enabled`, `data/helix.json`) | 0.8.0 |
| plugin re-reads `data/helix.json` while running | 0.8.2 |
| `unprotect_users` (mute exceptions) | 0.9.0 |
Older plugin + newer feature = the UI disables the control and explains why. Newer plugin than the UI knows = open read/write with a "some settings may be preserved but not editable" notice.

## 6. Recommended plugin change (not part of the web project; needs the owner's go-ahead)
Extract `E.check_reply` and the rule/timer constructors' validation into a pure module (`rules.lua` or a new `validate.lua`) with no `c2`/engine dependency, so the web app's in-browser Lua can run the exact same checks. Until then the web app vendors `util.lua`, `rules.lua`, `names.lua`, and a thin copy of `check_reply` covered by a contract test.

## 7. Test material
The plugin repo has a gitignored `auto-reply/tests/` with a labelled, anonymised chat fixture, `config.stream.json`, `config.fixed.json`, `config.customer.json` and `lua tests/run.lua`. Do not copy chat data into the web repo. Use them only through an optional env var (`PLUGIN_REPO=../auto-reply-plugin`) for local cross-checks; CI uses small synthetic fixtures. `config.customer.json` is a good real-world sample for the config reader (contains legacy shapes such as `{}` lists).
