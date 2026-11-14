import { OfflineError, type Api, type BackupInfo, type ConfigResponse, type DiscoverResponse, type RestoreResponse, type SaveResponse, type SelectResponse } from '../../shared/api-types.ts';
import type { Config } from '../../shared/config.ts';

const TOKEN_KEY = 'auto-reply-web.token';

/**
 * The session token arrives in the URL fragment (never sent to the server). Keep it in this tab's session storage
 * so a reload still works, and remove it from the address bar so it does not show up on a shared screen.
 */
export function readToken(loc: Pick<Location, 'hash' | 'pathname' | 'search'> = location, store: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string | null {
  const fromUrl = loc.hash.replace(/^#/, '');
  if (fromUrl) {
    try {
      store?.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* private mode: the token then lives only until a reload */
    }
    history.replaceState(null, '', loc.pathname + loc.search);
    return fromUrl;
  }
  try {
    return store?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

type Reply = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createClient(token: string | null, fetchFn: typeof fetch = (...a) => fetch(...a)): Api & { heartbeat(tab: string): Promise<void>; bye(tab: string): void } {
  async function raw(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<Reply> {
    if (!token) throw new OfflineError();
    let res: Response;
    try {
      res = await fetchFn(path, {
        method: init.method ?? 'GET',
        headers: { 'x-session-token': token, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        ...(init.keepalive ? { keepalive: true } : {}),
      });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 403 || res.status === 421) throw new OfflineError(); // wrong or missing session: open the app again
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, body };
  }
  const unexpected = (r: Reply) => new Error(`server answered ${r.status}${r.body && typeof r.body === 'object' && 'error' in r.body ? `: ${String(r.body.error)}` : ''}`);

  return {
    async discover() {
      const r = await raw('/api/discover');
      if (r.status !== 200) throw unexpected(r);
      return r.body as DiscoverResponse;
    },
    async select(path) {
      const r = await raw('/api/config/select', { method: 'POST', body: { path } });
      if (r.status === 200) return r.body as SelectResponse;
      if (r.status === 400) return { ok: false, error: String(r.body?.error ?? 'bad-request') };
      throw unexpected(r);
    },
    async loadConfig() {
      const r = await raw('/api/config');
      if (r.status !== 200) throw unexpected(r);
      return r.body as ConfigResponse;
    },
    async save(baseHash: string, config: Config) {
      const r = await raw('/api/config/save', { method: 'POST', body: { baseHash, config } });
      if (r.status === 200 || r.status === 409) return r.body as SaveResponse;
      throw unexpected(r);
    },
    async createDefault() {
      const r = await raw('/api/config/create-default', { method: 'POST', body: {} });
      if (r.status === 201 || r.status === 409) return r.body as { status: 'created' | 'exists' };
      throw unexpected(r);
    },
    async backups() {
      const r = await raw('/api/backups');
      if (r.status !== 200) throw unexpected(r);
      return (r.body as { backups: BackupInfo[] }).backups;
    },
    async restore(name) {
      const r = await raw('/api/backups/restore', { method: 'POST', body: { name } });
      if (r.status === 200 || r.status === 409) return r.body as RestoreResponse;
      throw unexpected(r);
    },
    async heartbeat(tab) {
      await raw('/api/heartbeat', { method: 'POST', body: { tab } });
    },
    bye(tab) {
      void raw('/api/bye', { method: 'POST', body: { tab }, keepalive: true }).catch(() => undefined);
    },
  };
}
