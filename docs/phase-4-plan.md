# Phase 4 plan: Timers and Redeems pages

Status: **implemented on the dev Mac** (lint, typecheck, 319 unit tests, 66 e2e tests, vendor check, build pass). Differences from the plan:
- The "stopped timer" verdict in the preview says "подходит, но не запущен: запустите его" even when another timer would also win; that is the more useful fact for a timer that is off.
- Start and stop buttons are named "Запустить сейчас: таймер X" and "Остановить: таймер X": the accessibility scan (label in name) rejected labels that did not contain the visible text.
- On a plugin older than 0.4.0 (or an unknown version) editing is disabled as a whole, not only the conditions: saving a legacy timer would write the new `conditions` shape, which such a plugin cannot read.
- `config.load` validates timer conditions (a running timer with a bad condition is stopped) and redeem shape (a redeem without a title or with a duration outside 1 s to 14 d is dropped), and sets `enabled` to false for a timer without a numeric `started_at`; the round-trip tests include these as controls. Verified on the vendored 0.5.0 `config.lua`.
- The Redeems page has no preview panel (the plan did not ask for one); the page default stays "Настройки" until Phase 5.
- The dev-only cross-check (`PLUGIN_REPO`) now includes the fixture's running timer: all 36 labelled timer questions are answered by the timer, with `{time}` rendered as in the plugin's own spec ("1 ч 6 мин"); a negative control with the timer switched off fails.

Goal: the user can build, order, switch and delete timers and redeems on two pages that work like the Rules page, with the plugin's own code doing every check, and a preview that now answers "what would the plugin do with this chat message" across timers and rules together.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| New timer | Created **off** (no start time). The user starts it on purpose |
| Running state | "Запустить сейчас" and "Остановить". Start sets `enabled` and `started_at` = now and clears `game_id`, with a warning that elapsed time starts from zero. Stop clears `enabled`, `started_at`, `game_id`. If the plugin changed the timer meanwhile, the plugin's value wins and the user is told |
| Preview | Timers first, then rules, on the Rules page, and the same preview with a sample elapsed time on the Timers page. A timer that is not running is shown as "не запущен, не сработает" |
| Lists | Order (buttons and drag), enable/disable (redeems), start/stop (timers) and delete with confirmation. No search, no bulk actions |
| Old plugin | Below 0.4.0 or unknown version: existing timers can be listed, started, stopped and deleted; creating and editing conditions is disabled with the reason |
| Reward title | Free text with an explanation (copy it from Twitch, a part is enough). Warnings for the same title twice in a channel (the plugin refuses it) and for a title that contains an earlier redeem's title (the earlier one wins) |
| Safety hints | Permanent "needs a moderator account" note; warning when a timeout redeem exists and the protected list (Settings) is empty; confirmation for a mute over 1 day; "channel not in the list" warning for timers and redeems |
| Duration | Text in the plugin's format (30s, 10m, 1h30m, 2d), parsed by the plugin's own `util.parse_duration`, shown in words ("10 минут") next to the field, with quick buttons 1 мин, 10 мин, 1 ч, 1 д. Range 1 s to 14 d |

## What the plugin does (read from its source, `engine.lua`)
- A timer answers only when `enabled` and `started_at` are set and its `channel` equals the message's channel; timers are checked in list order **before** all rules; the first match wins and ends the check.
- `{time}` in the reply is the elapsed time in the timer's `format`: `smart` (`только начал`, `45 мин`, `2 ч 35 мин`) or `full` (`2:35:00`); `util.format_elapsed` is vendored, so the examples shown in the constructor are the real ones.
- `on_category`: `reset` restarts counting when the stream category changes, `stop` stops the timer, `off` ignores it. The plugin stops a timer by itself when the stream goes offline. So the file's "running" is only true as of the moment it was read.
- When `game_id` is missing, the plugin fills it in on its next check (`check_timers`), so a timer started from the site gets its category without the site knowing it.
- A redeem matches when the reward text contains its title (case-insensitive, plain substring), in list order, and only for the redeem's channel. The plugin refuses a second redeem with the same title in a channel. `timeout` needs `seconds` from 1 to 1209600; `untimeout` has none.

## Design
- **Shared builder pieces.** The rule constructor is split into components that all three constructors use, with the Rules page behaviour unchanged (its e2e tests are the guard): `ConditionsEditor` (type picker, "и ещё" chain, patterns under "Для опытных"), `NameField` (with the suggestion), `SkipOptions`, and a reply field with the byte counter (`{user}` button, plus `{time}` for timers). The drag-and-order logic and the "restore focus after a move" helper move into one small module used by the Rules, Timers and Redeems pages.
- **Timers page** (`Timers.svelte`, `TimerEditor.svelte`): rows show position, name or reply start, conditions, channel, state ("запущен с 14 ноября, 17:05 (по файлу на момент открытия)" or "остановлен"), warnings, and buttons: start/stop, up, down, edit, delete. Editor: name, channel (one, from the channel list), conditions, reply with `{time}` required, format with live examples ("только начал", "2 ч 35 мин" / "2:35:00"), what to do when the category changes (plain wording), skip options. Live fields (`enabled`, `started_at`, `game_id`) are never part of the draft; editing a running timer keeps what the plugin has on disk (the existing three-way merge does this, with a test).
- **Start/stop** go through `session.edit` (one undo step each). If the save drops the user's change because the plugin changed the timer (the merge reports "live value kept from the plugin"), a banner says so by timer name. The reload note appears as for any save.
- **Redeems page** (`Redeems.svelte`, `RedeemEditor.svelte`): name, channel, reward title, action (timeout or unmute), duration for timeout, enabled switch. Notes: needs a moderator account (not promised to work: UNVERIFIED in the real app), unmute needs no duration, mutes are subject to Settings (protected list, "backfire", "mute lurkers"), which the page links to by name.
- **Checks, all in the plugin's code or a marked thin copy** (`src/lua/uichecks.lua`):
  - timers: reply (`check_reply` copy already there), `{time}` present (a one-line copy of the check inside `E.add_timer`; a test fails if the plugin source stops containing that check), conditions (`rules.validate`), name (`names.check` with `timers`), shadowing by an earlier timer (same sample approach as rules), channel not in the list;
  - redeems: title not empty, duplicate title per channel, title contained in an earlier title (a marked copy of the engine's substring rule using the plugin's `rules.lower`), `seconds` range, name (`names.check` with `redeems`);
  - duration text: `util.parse_duration` (plugin) then range; words in Russian from a small tested TypeScript function (plural forms).
- **Preview.** A new Lua entry runs timers first (running and on the right channel), then rules, and returns the winner with its kind. The Rules page uses it with the timers in the file; the Timers page adds a sample elapsed time field (default 2 ч 35 мин) and shows the rendered `{time}`. Cooldowns, the ignore list, moderator skipping and the stream status are not simulated, and the page says so.
- **Pages and navigation.** Sidebar items "Таймеры" and "Награды" become active; the default page stays "Настройки" until Phase 5.
- **Strings** in `src/i18n/ru.ts`: plain Russian, no jargon in the main path; the category options are worded as "перезапустить счётчик", "остановить счётчик", "ничего не делать".
- **Ids and order.** New items take `next_timer_id` / `next_redeem_id`; ids are never reused. Unknown keys, legacy timer `trigger`, `{}` empty lists are preserved; a legacy timer is written back in the new shape only when edited.

## Steps (test first for logic; a real browser for what only a browser can show)
1. **Model helpers** (timers and redeems: add, edit in place, delete, move, drag, start/stop, ids never reused, live keys untouched by edits, legacy `trigger` kept until edited). Unit tests, including a three-way merge case where the plugin changed `started_at` while the user edited the reply.
2. **Duration text**: Russian words with plural forms and the quick values; tests.
3. **Lua checks**: timers analysis, redeems analysis, combined preview; tests with the real Lua; the `{time}` drift guard against `PLUGIN_REPO`.
4. **Round-trip acceptance**: timers and redeems built by the constructor pass the plugin's own `config.load` (it validates timer conditions and redeem shape, so a control case with a bad condition proves the test can fail).
5. **Refactor** the Rules constructor into the shared components and the shared order helper; the existing Rules e2e tests must pass unchanged.
6. **Timers page and constructor**, then **Redeems page and constructor**, then the combined preview on the Rules page.
7. **Strings**, sidebar, navigation.
8. **e2e and accessibility**: create a timer (off), start with the warning, stop, merge with a plugin change, reorder and drag, delete; old plugin view-only; redeem validation (duplicates, title contained, duration, long-mute confirmation, safety hints); the combined preview; axe scans of both pages and dialogs; keyboard-only reorder with focus restored.
9. **Verify**: lint, typecheck, unit, e2e, vendor check, build; update `CHANGELOG.md`, `CLAUDE.md`, `PLAN.md`.

## Acceptance
- A timer and a redeem built in the UI are accepted by the plugin's own `config.load` unchanged and appear in the list with the same description.
- Editing a running timer never changes `enabled`, `started_at` or `game_id` on disk, even when the plugin changed them after the file was opened.
- The preview answers the timer scenarios from the plugin's labelled chat fixture the same way as the plugin's own spec when a timer is running (dev-only cross-check with `PLUGIN_REPO`, skipped without it).
- Everything works with the keyboard alone; axe finds nothing on the new screens; no new network requests; strict CSP unchanged.

## Open items, UNVERIFIED
- Moderator-badge and reward-title detection in the real Leafyrino app (the pages say "needs a moderator account" and do not promise more).
- That the plugin fills `game_id` on its next check for a timer started from the site: read from `check_timers`, not run.
- A timer shown as running may already have stopped (the plugin stops it when the stream goes offline); the page says the state is as of the opening of the file.
- Real Windows and a real Leafyrino folder are untested for the whole site so far.
