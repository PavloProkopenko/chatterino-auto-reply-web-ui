import { TWITCH_ID_ORIGIN, TWITCH_SCOPES } from '../../shared/twitch.ts';

/**
 * Twitch OAuth device-code login, run in the browser (id.twitch.tv answers cross-origin requests).
 * Everything time- and network-dependent is injected, like the rest of the data layer, so it is tested
 * with a scripted fetch and a fake clock.
 *
 * The token only ever lives in the object `finishDeviceLogin` returns and goes straight into
 * data/helix.json (helix-file.ts). It is never put in UI state, logged, or included in an error message.
 */

/** Shape stored in data/helix.json (the plugin's helix.lua reads exactly these keys). */
export interface StoredLogin {
  client_id: string;
  access_token: string;
  refresh_token?: string;
  /** Unix seconds. */
  expires_at: number;
  user_id: string;
  login: string;
  scopes: string[];
}

export interface FlowDeps {
  fetch: typeof fetch;
  now?: () => number;
  /** Resolves after `ms` or as soon as the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface DeviceStart {
  /** What the user types on the Twitch page. */
  userCode: string;
  /** Always an https link on twitch.tv. */
  verificationUri: string;
  /** ms since the epoch. */
  expiresAt: number;
  intervalMs: number;
  deviceCode: string;
}

export type StartResult = { status: 'ok'; start: DeviceStart } | { status: 'error'; message: string };
export type LoginResult = { status: 'ok'; login: StoredLogin } | { status: 'denied' } | { status: 'expired' } | { status: 'cancelled' } | { status: 'error'; message: string };

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });

async function call(deps: FlowDeps, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await deps.fetch(url, init);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* an empty or non-JSON body: only the status counts */
  }
  return { status: res.status, body };
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const failure = (e: unknown) => (e instanceof Error && e.message ? e.message : 'network error');

function twitchLink(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'twitch.tv' || u.hostname.endsWith('.twitch.tv')) ? u.href : null;
  } catch {
    return null;
  }
}

export async function startDeviceLogin(clientId: string, deps: FlowDeps): Promise<StartResult> {
  const now = deps.now ?? Date.now;
  try {
    const r = await call(deps, `${TWITCH_ID_ORIGIN}/oauth2/device`, { method: 'POST', headers: FORM, body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPES }) });
    const b = r.body;
    if (r.status !== 200 || !text(b.device_code) || !text(b.user_code)) return { status: 'error', message: text(b.message) || `HTTP ${r.status}` };
    const link = twitchLink(text(b.verification_uri));
    if (!link) return { status: 'error', message: 'Twitch returned an unexpected link' };
    return {
      status: 'ok',
      start: { userCode: text(b.user_code), verificationUri: link, deviceCode: text(b.device_code), expiresAt: now() + (Number(b.expires_in) || 1800) * 1000, intervalMs: Math.max(1, Number(b.interval) || 5) * 1000 },
    };
  } catch (e) {
    return { status: 'error', message: failure(e) };
  }
}

/** Polls until the user answers, the code runs out, or `signal` aborts. */
export async function finishDeviceLogin(clientId: string, start: DeviceStart, deps: FlowDeps, signal: AbortSignal): Promise<LoginResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  let interval = start.intervalMs;
  try {
    for (;;) {
      await sleep(interval, signal);
      if (signal.aborted) return { status: 'cancelled' };
      if (now() >= start.expiresAt) return { status: 'expired' };
      const r = await call(deps, `${TWITCH_ID_ORIGIN}/oauth2/token`, {
        method: 'POST',
        headers: FORM,
        body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPES, device_code: start.deviceCode, grant_type: GRANT }),
      });
      if (r.status === 200 && text(r.body.access_token)) return await identify(clientId, r.body, deps, now);
      const message = text(r.body.message);
      if (message === 'authorization_pending') continue;
      if (message === 'slow_down') {
        interval += 5000;
        continue;
      }
      if (message === 'access_denied') return { status: 'denied' };
      if (message.includes('invalid device code')) return { status: 'expired' };
      return { status: 'error', message: message || `HTTP ${r.status}` };
    }
  } catch (e) {
    return { status: 'error', message: failure(e) };
  }
}

async function identify(clientId: string, token: Record<string, unknown>, deps: FlowDeps, now: () => number): Promise<LoginResult> {
  const access = text(token.access_token);
  const v = await call(deps, `${TWITCH_ID_ORIGIN}/oauth2/validate`, { headers: { Authorization: `OAuth ${access}` } });
  if (v.status !== 200 || !text(v.body.login)) return { status: 'error', message: text(v.body.message) || `HTTP ${v.status}` };
  const scopes = Array.isArray(v.body.scopes) ? v.body.scopes.filter((s): s is string => typeof s === 'string') : [];
  const refresh = text(token.refresh_token);
  return {
    status: 'ok',
    login: {
      client_id: clientId,
      access_token: access,
      ...(refresh ? { refresh_token: refresh } : {}),
      expires_at: Math.floor(now() / 1000) + (Number(token.expires_in) || 3600),
      user_id: text(v.body.user_id),
      login: text(v.body.login).toLowerCase(),
      scopes,
    },
  };
}

/** Best effort: the token is cleared locally either way, so a failure here is not reported. */
export async function revokeToken(clientId: string, token: string, deps: FlowDeps): Promise<void> {
  try {
    await deps.fetch(`${TWITCH_ID_ORIGIN}/oauth2/revoke`, { method: 'POST', headers: FORM, body: new URLSearchParams({ client_id: clientId, token }) });
  } catch {
    /* offline or blocked: nothing to do */
  }
}
