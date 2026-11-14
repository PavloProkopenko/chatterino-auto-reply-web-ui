import type { LuaClient } from '../../lua/client.ts';
import { ru } from '../../i18n/ru.ts';

export type Checked = { ok: true; value: string } | { ok: false; error: string };

/** Channel login check: the plugin's own `util.parse_channels`, so the UI accepts exactly what `/autoreply` accepts. */
export function channelValidator(lua: LuaClient) {
  return async (token: string): Promise<Checked> => {
    const [list, err] = await lua.call('util', 'parse_channels', token);
    if (typeof err === 'string') return { ok: false, error: err };
    // "all" gives {} (a global rule), which is not a channel name
    if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== 'string') return { ok: false, error: ru.settings.lists.notChannel };
    return { ok: true, value: list[0] };
  };
}

/** User login check through `util.parse_skip`; `mods` / `nomods` are keywords there, not names. */
export function userValidator(lua: LuaClient) {
  return async (token: string): Promise<Checked> => {
    const [spec, err] = await lua.call('util', 'parse_skip', token);
    if (typeof err === 'string') return { ok: false, error: err };
    const s = spec as { mods?: boolean | null; users?: unknown } | null;
    const users = s?.users;
    if (!s || (s.mods !== undefined && s.mods !== null) || !Array.isArray(users) || users.length !== 1 || typeof users[0] !== 'string') {
      return { ok: false, error: ru.settings.lists.notUser };
    }
    return { ok: true, value: users[0] };
  };
}

export type NumberCheck = { ok: true; value: number } | { ok: false; error: string };

/**
 * Whole seconds in [min, max]. The range is the one `/autoreply set` enforces (commands.lua cmd_set:
 * 0..86400, and `gap` at least 1). That function is not vendored, so these numbers are copied: UI limit.
 */
export function checkSeconds(text: string, min: number, max: number): NumberCheck {
  const t = text.trim();
  if (t === '') return { ok: false, error: ru.settings.number.required };
  if (!/^\d+$/.test(t)) return { ok: false, error: ru.settings.number.required };
  const n = Number(t);
  if (n < min) return { ok: false, error: ru.settings.number.min(min) };
  if (n > max) return { ok: false, error: ru.settings.number.max(max) };
  return { ok: true, value: n };
}
