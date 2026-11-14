# Phase 3 plan: Rules page and constructor

Status: **implemented on the dev Mac** (lint, typecheck, 275 unit tests, 49 e2e tests, vendor check, build pass). Differences from the plan:
- The reply counter counts **bytes**, as the plugin does (`#reply > 500`), so a Russian reply fits about 250 letters; the field says so. The plan said "characters".
- The preview does not take `shadowedBy` as an input: the verdict "подходит, но раньше сработает правило № N" comes from the preview run itself; the list's shadow hint comes from `uichecks.analyse`.
- Name suggestion and the Lua checks run in one module, `src/lua/uichecks.lua`, called through the existing client; the page default stays "Настройки" until Phase 5 (main page).
- `config.load` does not validate rule conditions (only rule channels), so a rule with a bad condition is not dropped by the plugin, it just never matches; the hints say "не сработает". Verified on the vendored 0.5.0 `config.lua`; UNVERIFIED on a real build.
- Focus is restored after a move and the new position is announced to screen readers (found by the keyboard-only e2e test).

Goal: the user can see every rule in order, search, reorder, enable or disable, delete, and build or edit a rule in a side panel, with a live preview that runs the plugin's own Lua. Saving uses the existing flow (open + download in the browser; direct write where available), and the plugin still needs `/autoreply reload`.

## Owner decisions for this phase
| Topic | Decision |
|---|---|
| Constructor | Side panel: the list stays on the left, constructor and preview on the right |
| Order | Up/down buttons and drag. Each row shows its position number; the page says "first matching rule wins" |
| Preview | Whole list plus the rule being edited: a typed message, a sender login, flags (moderator, first message, and so on). Shows which rule wins, the exact reply with `{user}` filled in, whether the edited rule matches, and which earlier rule shadows it |
| Pattern condition | Hidden under "Advanced" with a warning and examples. Existing pattern conditions stay visible and editable |
| Bulk actions | Enable/disable selected, delete selected (with confirmation), move to top/bottom. No duplicate |
| Names | Optional, validated by the plugin's `names` module (1-20 chars, unique, case-insensitive, not a reserved word). A "suggest" button proposes a free name from the reply. A rule without a name is shown by the start of its reply |
| Warnings per rule | Dormant (channel not in the channel list); shadowed by an earlier rule; invalid reply or condition; needs a newer plugin or version unknown |
| Reply field | "Вставить {user}" button at the cursor, a length counter against 500, a warning for a leading `/` or `.`. `{time}` is not offered for rules |

## Design
- **Page.** `src/ui/pages/Rules.svelte` replaces the "скоро" badge in the sidebar. Rows: position, enabled switch, name or reply start, a one-line description of the conditions (the plugin's `rules.describe`), channel scope, warning badges, and the move/edit actions. Search filters by name, reply and condition text. While a filter is active, reordering and drag are disabled (the order shown would not be the real order) and the page says why.
- **Constructor** (`RuleEditor.svelte`): name, conditions (an AND chain with add/remove), reply, channels, skip options, enabled.
  - Condition type picker with a plain-language help line per type, taken from the plugin's `rules.TYPE_INFO` and `FLAG_INFO` where they exist (Russian text stays in `src/i18n/ru.ts`). Types shown: keyword, word, anyword, mention, flag. `pattern` appears only under "Advanced".
  - The chain is described in words: "и ещё", never "AND".
  - Channels: pick from the global channel list (empty means all). A rule with a channel that is not in the list shows the dormant warning.
  - `skip_mods` as three states (follow global, skip mods, do not skip) and `skip_users` as the existing chip list, both disabled with an explanation for plugins older than 0.5.0. Names need 0.2.1, channel scope 0.3.0. With an unknown plugin version these controls are disabled and say why.
  - Edits go through `session.edit`, so undo/redo, coalescing, conflict merge and save all work as on the Settings page. The panel edits a draft; "Готово" applies it as one undo step, "Отмена" discards it.
- **Validation: the plugin's own code, not a copy.**
  - Conditions: `rules.validate(type, match)`. Names: `names.check`. Reply: the plugin's `E.check_reply` lives in `engine.lua`, which is not pure and not vendored (CONTRACT §6). Until the plugin extracts it, add a thin Lua copy under `src/lua/` (empty, over 500 chars, leading `/` or `.`), covered by a contract test that compares it with the plugin's real `check_reply` when `PLUGIN_REPO` is set. Marked as a copy in the code. This is a UI limit like the number ranges, not matching logic.
- **Preview** uses `rules.matches`, `rules.lower`, `rules.applies_to_channel`, `rules.is_usable`, and `rules.sample` (to prefill a message that should match the edited rule). The page runs the list in order, as the plugin does, and the first match wins. No matching logic in TypeScript.
  - Preview runs in the existing Lua Worker with its timeout, so a runaway pattern stops the preview and the page stays usable.
  - Sender login, channel, and flags are inputs; the own account login for `mention` is an input too (UNVERIFIED: what the plugin passes as `me` in a real chat).
  - Timers are checked before rules in the plugin. The preview says so in one line and does not simulate timers (Phase 4).
- **Warnings** are computed from the same data: dormant (`applies_to_channel` against `channels`), invalid (reply check, `validate`, names), version gating (`featuresFor`), and shadowed (an earlier usable rule matches the edited rule's sample text and its flags; found by running `rules.sample` through the list). Shadow detection is a best-effort hint and says so.
- **Ids.** New rules take `next_rule_id` and increment it; ids are never reused, also after a delete and undo. Delete leaves the counter alone.
- **Preserved as is:** unknown keys on rules, legacy `type`/`match` rules (shown as one condition, written back in the new shape only when edited), `{}` for empty lists.

## Steps (test first for logic; a real browser for what only a browser can show)
1. **Rule model helpers** (`src/ui/state/rules.ts`): add, edit, delete, move, move to top/bottom, enable/disable several, id counter, name suggestion. Unit tests: ids never reused, legacy shapes, unknown keys kept, empty lists.
2. **Plugin-backed checks** (`src/ui/state/rule-checks.ts`): reply, condition, name validation and warnings over the Lua client. Contract test for the reply copy. Tests with the real Lua in WASM.
3. **Preview engine**: run the list for a message, sender and flags; the winning rule; the shadow hint. Tests with synthetic rules (donate, playlist, flags, mention, Cyrillic, Ukrainian letters).
4. **Cross-check** (dev-only, needs `PLUGIN_REPO`): the labelled chat fixtures from the plugin repo give the same winning rule through the preview as `lua tests/run.lua`. Skipped, not failed, when the variable is not set.
5. **Rules list and bulk actions** (`Rules.svelte`): search, selection, order buttons, drag, bulk bar, delete confirmation, warnings, empty state. Sidebar item becomes active.
6. **Constructor and preview panel** (`RuleEditor.svelte`, `RulePreview.svelte`): conditions chain, help lines, Advanced section, reply field with counter and `{user}` button, channels, skip, name suggestion.
7. **Strings** in `src/i18n/ru.ts` (Russian, plain language, no jargon in the main path).
8. **e2e and accessibility** (Playwright): create, edit, reorder with keyboard, drag, bulk, search with order locked, preview, warnings, download flow. Axe scan on the list, the panel and the bulk bar. Keyboard-only test.
9. **Verify**: lint, typecheck, unit, e2e, vendor check, build; update `CHANGELOG.md`, `CLAUDE.md`, `PLAN.md`.

## Acceptance
- A rule created in the UI is accepted by the plugin's own `config.load` (run through the Lua sanitiser) and appears with the same description in the list.
- The donate, playlist and timer scenarios from the plugin's labelled chat fixtures pass through the preview with the same results as `lua tests/run.lua` (dev-only cross-check).
- Everything works with the keyboard alone; axe finds nothing on the new screens.
- No new network requests; strict CSP unchanged (no inline styles, no Svelte transitions).

## Open items, UNVERIFIED
- What the plugin passes as `me` for `mention` in a real chat, and how Leafyrino handles emotes and links in replies. The preview does not claim either.
- Shadow detection is a hint, not a proof: it samples text from the later rule's own conditions.
- Real Windows and real Leafyrino are untested for the whole site so far.
