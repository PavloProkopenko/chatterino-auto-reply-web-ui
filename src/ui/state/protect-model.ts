import type { Config } from '../../shared/config.ts';

/**
 * The protected-users switches as pure functions over the two config lists:
 * `protect_users` (on) and `unprotect_users` (off: may be muted even if a badge or a bot list says otherwise,
 * plugin 0.9.0). Everything here mutates the config it is given, so callers run it inside `session.edit`.
 */

type Lists = Pick<Config, 'protect_users' | 'unprotect_users'>;

export interface ProtectRow {
  login: string;
  /** On = protected. */
  enabled: boolean;
  /** The channel owner and the account itself are protected by the plugin whatever the lists say. */
  locked: boolean;
}

const LOGIN = /^[a-z0-9_]{1,25}$/;
const norm = (login: string) => login.trim().replace(/^@/, '').toLowerCase();

/** One row per login, sorted. An exception wins over a protect_users entry (a hand-edited file may have both). */
export function rows(logins: string[], cfg: Lists, always: string[]): ProtectRow[] {
  const locked = new Set(always.map(norm));
  const protectedSet = new Set(cfg.protect_users);
  const exceptions = new Set(cfg.unprotect_users);
  const seen = [...new Set(logins.map(norm))].filter((l) => l !== '');
  return seen
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((login) => (locked.has(login) ? { login, enabled: true, locked: true } : { login, enabled: protectedSet.has(login) && !exceptions.has(login), locked: false }));
}

const remove = (list: string[], login: string) => {
  const i = list.indexOf(login);
  if (i !== -1) list.splice(i, 1);
};

/** on: protected (and no longer an exception). off: not protected and an explicit exception. Locked logins stay on. */
export function setProtected(cfg: Lists, login: string, on: boolean, always: string[]): void {
  const l = norm(login);
  if (!l) return;
  if (on) {
    if (!cfg.protect_users.includes(l)) cfg.protect_users.push(l);
    remove(cfg.unprotect_users, l);
    return;
  }
  if (always.map(norm).includes(l)) return;
  remove(cfg.protect_users, l);
  if (!cfg.unprotect_users.includes(l)) cfg.unprotect_users.push(l);
}

export function setAll(cfg: Lists, logins: string[], on: boolean, always: string[]): void {
  for (const l of logins) setProtected(cfg, l, on, always);
}

/** Protects the people of a fresh fetch who are not in either list yet; returns how many were added. */
export function applyFetched(cfg: Lists, logins: string[]): number {
  let added = 0;
  for (const raw of new Set(logins.map(norm))) {
    if (!raw || cfg.protect_users.includes(raw) || cfg.unprotect_users.includes(raw)) continue;
    cfg.protect_users.push(raw);
    added += 1;
  }
  return added;
}

const clean = (piece: string) => norm(piece).replace(/\.+$/, '');

/**
 * Logins from what the user pastes: the answer of the chat commands (`/mods`: "The moderators of this channel
 * are: a, b", `/vips`: "The VIPs of this channel are: a, b.", with or without a timestamp in front) or a plain list
 * (comma separated, or one per line). Sentences without a list ("This channel does not have any moderators.") give nothing.
 */
export function parsePasted(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const marked = /(?:moderators?|vips?)\b[^:]*:\s*(.*)$/i.exec(t);
    let list: string | null = null;
    if (marked) list = marked[1]!;
    else if (t.includes(',') || !/\s/.test(t)) list = t;
    if (list === null) continue;
    for (const piece of list.split(/[,;]/)) {
      const login = clean(piece);
      if (LOGIN.test(login) && !out.includes(login)) out.push(login);
    }
  }
  return out;
}
