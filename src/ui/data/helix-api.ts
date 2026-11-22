import { TWITCH_API_ORIGIN } from '../../shared/twitch.ts';
import type { HelixAuth } from './helix-file.ts';

/**
 * The few read-only Twitch API calls the site makes (CSP: https://api.twitch.tv): who the account moderates,
 * and the mods and VIPs of the account's own channel. Pure over an injected `fetch`.
 *
 * The token is only a header value here; no error, message or return value ever contains it.
 */

export type HelixErrorKind = 'scope' | 'notOwner' | 'expired' | 'network' | 'other';

export class HelixApiError extends Error {
  kind: HelixErrorKind;
  constructor(kind: HelixErrorKind, message: string) {
    super(message);
    this.name = 'HelixApiError';
    this.kind = kind;
  }
}

export interface ApiDeps {
  fetch: typeof fetch;
}

const MAX_PAGES = 20; // like the plugin's own list fetch: 2000 entries, then stop

function classify(status: number, message: string): HelixErrorKind {
  const m = message.toLowerCase();
  if (status === 401) {
    if (/must match the user id|broadcaster_id/.test(m)) return 'notOwner';
    if (/scope/.test(m)) return 'scope';
    return 'expired'; // invalid / missing / expired token, and anything unrecognised
  }
  if (status === 403) return 'scope';
  return 'other';
}

async function get(deps: ApiDeps, auth: HelixAuth, path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(`${TWITCH_API_ORIGIN}/helix${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await deps.fetch(url.href, { headers: { Authorization: `Bearer ${auth.token}`, 'Client-Id': auth.clientId } });
  } catch {
    throw new HelixApiError('network', 'network error');
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* no body: only the status counts */
  }
  if (res.status !== 200) {
    const text = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
    throw new HelixApiError(classify(res.status, text), text);
  }
  return body;
}

/** Follows `pagination.cursor`; `pick` turns one row into a login (or null to skip it). */
async function pages(deps: ApiDeps, auth: HelixAuth, path: string, query: Record<string, string>, field: string): Promise<string[]> {
  const out: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get(deps, auth, path, { ...query, first: '100', ...(after ? { after } : {}) });
    const rows = Array.isArray(body.data) ? (body.data as unknown[]) : [];
    for (const row of rows) {
      const v = row && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
      if (typeof v === 'string' && v !== '') out.push(v.toLowerCase());
    }
    const cursor = (body.pagination as { cursor?: unknown } | undefined)?.cursor;
    if (typeof cursor !== 'string' || cursor === '') break;
    after = cursor;
  }
  return out;
}

/** Logins of the channels the account moderates (needs the `user:read:moderated_channels` scope). */
export const moderatedChannels = (deps: ApiDeps, auth: HelixAuth) => pages(deps, auth, '/moderation/channels', { user_id: auth.userId }, 'broadcaster_login');

/** Moderators of a channel. Twitch only answers when the account owns that channel. */
export const listMods = (deps: ApiDeps, auth: HelixAuth, broadcasterId: string) => pages(deps, auth, '/moderation/moderators', { broadcaster_id: broadcasterId }, 'user_login');

/** VIPs of a channel. Twitch only answers when the account owns that channel. */
export const listVips = (deps: ApiDeps, auth: HelixAuth, broadcasterId: string) => pages(deps, auth, '/channels/vips', { broadcaster_id: broadcasterId }, 'user_login');

/** The account behind a login, or null when there is none. */
export async function userByLogin(deps: ApiDeps, auth: HelixAuth, login: string): Promise<{ id: string; login: string } | null> {
  const body = await get(deps, auth, '/users', { login });
  const row = Array.isArray(body.data) ? (body.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row || typeof row.id !== 'string') return null;
  return { id: row.id, login: (typeof row.login === 'string' ? row.login : login).toLowerCase() };
}
