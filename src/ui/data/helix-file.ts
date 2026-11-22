/** What the UI may know: who is logged in and which rights the login has. Deliberately has no token field. */
export interface HelixStatus {
  loggedIn: boolean;
  login: string | null;
  clientId: string | null;
  /** Twitch's numeric id of the account; null when the file does not have it. */
  userId: string | null;
  /** Granted scopes as Twitch reported them at login; [] when unknown. */
  scopes: string[];
}

import type { PluginDir } from './ports.ts';
import { revokeToken, type FlowDeps, type StoredLogin } from './twitch-flow.ts';

/**
 * data/helix.json: the plugin's Twitch login (see helix.lua in the plugin). The site writes it ONLY on
 * login and logout; the plugin owns it otherwise (it refreshes tokens, which Twitch rotates, so the site
 * must never refresh). Unknown keys are kept. The file is never backed up (backups copy only top-level
 * *.lua and info.json), never shown and never logged.
 */
export const HELIX_FILE = 'data/helix.json';

/** Keys that make up "a login"; `client_id` and anything unknown stay when the user logs out. */
const LOGIN_KEYS = ['access_token', 'refresh_token', 'expires_at', 'user_id', 'login', 'scopes'] as const;

/** What the UI may know: who is logged in. Deliberately has no token field. */
export interface HelixStatus {
  loggedIn: boolean;
  login: string | null;
  clientId: string | null;
}

type Store = Record<string, unknown>;

function parse(raw: string | null): Store | null {
  if (raw === null || raw === '') return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The token only exists inside this module's functions, and only for as long as one call needs it. */
export async function readHelixStatus(dir: PluginDir): Promise<HelixStatus> {
  const s = parse(await dir.read(HELIX_FILE));
  if (!s) return { loggedIn: false, login: null, clientId: null, userId: null, scopes: [] };
  const loggedIn = str(s.access_token) !== null;
  return { loggedIn, login: loggedIn ? str(s.login) : null, clientId: str(s.client_id), userId: loggedIn ? str(s.user_id) : null, scopes: loggedIn ? strList(s.scopes) : [] };
}

/** What a Twitch API call needs. Only ever passed to the callback of `withHelixToken`. */
export interface HelixAuth {
  token: string;
  clientId: string;
  userId: string;
  login: string | null;
}

/**
 * Reads the login for ONE call: `fn` gets the token and its result is returned, the token itself never is.
 * The site does not refresh tokens (the plugin does), so a token the plugin could not refresh in time is
 * simply rejected by Twitch (401) and reported by the caller. Nothing is written.
 */
export async function withHelixToken<T>(dir: PluginDir, fn: (auth: HelixAuth) => Promise<T>): Promise<{ status: 'ok'; value: T } | { status: 'notLoggedIn' }> {
  const s = parse(await dir.read(HELIX_FILE));
  const token = s ? str(s.access_token) : null;
  const clientId = s ? str(s.client_id) : null;
  const userId = s ? str(s.user_id) : null;
  if (!s || !token || !clientId || !userId) return { status: 'notLoggedIn' };
  return { status: 'ok', value: await fn({ token, clientId, userId, login: str(s.login) }) };
}

/** Replaces the login, keeping unknown keys. A corrupt file is replaced. Throws when the write fails. */
export async function writeHelixLogin(dir: PluginDir, login: StoredLogin): Promise<void> {
  const s = parse(await dir.read(HELIX_FILE)) ?? {};
  for (const k of LOGIN_KEYS) delete s[k];
  await dir.write(HELIX_FILE, JSON.stringify({ ...s, ...login }, null, 2) + '\n');
}

/** Removes the token and the account; keeps the client id. Does nothing (and creates nothing) when logged out. */
export async function clearHelixLogin(dir: PluginDir): Promise<void> {
  const s = parse(await dir.read(HELIX_FILE));
  if (!s || !LOGIN_KEYS.some((k) => k in s)) return;
  for (const k of LOGIN_KEYS) delete s[k];
  await dir.write(HELIX_FILE, JSON.stringify(s, null, 2) + '\n');
}

/** Logs out locally first (so it always works), then asks Twitch to revoke the token. */
export async function logoutHelix(dir: PluginDir, deps: FlowDeps): Promise<void> {
  const s = parse(await dir.read(HELIX_FILE));
  const token = s ? str(s.access_token) : null;
  const clientId = s ? str(s.client_id) : null;
  await clearHelixLogin(dir);
  if (token && clientId) await revokeToken(clientId, token, deps);
}
