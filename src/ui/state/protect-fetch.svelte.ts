import { HelixApiError, listMods, listVips } from '../data/helix-api.ts';
import { withHelixToken, type HelixStatus } from '../data/helix-file.ts';
import type { PluginDir } from '../data/ports.ts';
import { parsePasted } from './protect-model.ts';

export type ListKind = 'mods' | 'vips';

export type ProtectFetchError = { kind: 'notLoggedIn' | 'notOwner' | 'scope' | 'expired' | 'network' } | { kind: 'other'; message: string };

export interface ListEntry {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  logins: string[];
  error: ProtectFetchError | null;
}

export interface ProtectFetchDeps {
  dir: () => PluginDir | null;
  fetch: typeof fetch;
  status: () => HelixStatus | null;
  /** Called with the logins of every successful fetch or paste: the app protects the new ones. */
  onFetched: (logins: string[]) => void;
}

const IDLE: ListEntry = { status: 'idle', logins: [], error: null };
const norm = (channel: string) => channel.trim().replace(/^#/, '').toLowerCase();
const key = (channel: string, kind: ListKind) => `${norm(channel)}|${kind}`;

/**
 * Mods and VIPs of a channel, one list each, kept for this visit only (the switches themselves live in the config).
 * Twitch answers only the owner of the channel, so a fetch for any other channel is refused up front; the paste
 * route fills the same lists from the answer of `/mods` and `/vips` in the chat.
 */
export class ProtectFetch {
  #entries = $state.raw<Record<string, ListEntry>>({});

  readonly #deps: ProtectFetchDeps;

  constructor(deps: ProtectFetchDeps) {
    this.#deps = deps;
  }

  entry(channel: string, kind: ListKind): ListEntry {
    return this.#entries[key(channel, kind)] ?? IDLE;
  }

  #set(channel: string, kind: ListKind, e: ListEntry) {
    this.#entries = { ...this.#entries, [key(channel, kind)]: e };
  }

  reset(): void {
    this.#entries = {};
  }

  async fetch(channelName: string, kind: ListKind): Promise<void> {
    const channel = norm(channelName);
    const previous = this.entry(channel, kind);
    if (previous.status === 'loading') return;
    const fail = (error: ProtectFetchError) => this.#set(channel, kind, { status: 'error', logins: previous.logins, error });
    const status = this.#deps.status();
    if (!status?.loggedIn) return fail({ kind: 'notLoggedIn' });
    if (channel !== status.login) return fail({ kind: 'notOwner' });
    const dir = this.#deps.dir();
    if (!dir) return fail({ kind: 'notLoggedIn' });
    this.#set(channel, kind, { status: 'loading', logins: previous.logins, error: null });
    try {
      const api = { fetch: this.#deps.fetch };
      const out = await withHelixToken(dir, (auth) => (kind === 'mods' ? listMods(api, auth, auth.userId) : listVips(api, auth, auth.userId)));
      if (out.status === 'notLoggedIn') return fail({ kind: 'notLoggedIn' });
      this.#set(channel, kind, { status: 'loaded', logins: out.value, error: null });
      this.#deps.onFetched(out.value);
    } catch (e) {
      if (e instanceof HelixApiError) fail(e.kind === 'other' ? { kind: 'other', message: e.message } : { kind: e.kind });
      else fail({ kind: 'other', message: 'unexpected error' });
    }
  }

  /** Adds the logins found in pasted chat output to the list; returns how many were found (0: nothing changed). */
  paste(channel: string, kind: ListKind, text: string): number {
    const found = parsePasted(text);
    if (found.length === 0) return 0;
    const previous = this.entry(channel, kind);
    const merged = [...previous.logins];
    for (const l of found) if (!merged.includes(l)) merged.push(l);
    this.#set(channel, kind, { status: 'loaded', logins: merged, error: null });
    this.#deps.onFetched(found);
    return found.length;
  }
}
