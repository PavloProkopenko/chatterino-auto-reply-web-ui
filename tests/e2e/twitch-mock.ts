import type { Page } from '@playwright/test';

export interface TwitchMock {
  /** "METHOD path" of every request that reached the fake id.twitch.tv, in order. */
  calls: string[];
  /** Bodies posted to /oauth2/revoke. */
  revoked: string[];
  /** Bodies posted to /oauth2/device (the client id and scopes the site asked with). */
  deviceBodies: string[];
}

export interface TwitchMockOptions {
  /** Token polls answered "pending" before the login succeeds. */
  pending?: number;
  /** Answer the token poll with this Twitch message instead of succeeding (e.g. access_denied). */
  tokenError?: string;
  login?: string;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST' };

/**
 * A scripted id.twitch.tv for the e2e tests, including the CORS preflight the real one answers: the site's
 * validate call sends an Authorization header, which makes the browser ask first. interval 1 keeps tests fast.
 */
export async function mockTwitch(page: Page, opts: TwitchMockOptions = {}): Promise<TwitchMock> {
  const mock: TwitchMock = { calls: [], revoked: [], deviceBodies: [] };
  let polls = 0;
  await page.route('https://id.twitch.tv/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS });
    mock.calls.push(`${req.method()} ${path}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (path === '/oauth2/device') mock.deviceBodies.push(req.postData() ?? '');
    if (path === '/oauth2/device') return json(200, { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD', expires_in: 1800, interval: 1 });
    if (path === '/oauth2/token') {
      polls += 1;
      if (opts.tokenError) return json(400, { status: 400, message: opts.tokenError });
      if (polls <= (opts.pending ?? 1)) return json(400, { status: 400, message: 'authorization_pending' });
      return json(200, { access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_in: 14000, scope: [] });
    }
    if (path === '/oauth2/validate') return json(200, { client_id: 'cid1234567', login: opts.login ?? 'Streamer', user_id: '1000', scopes: ['channel:read:redemptions', 'moderation:read', 'channel:read:vips'], expires_in: 14000 });
    if (path === '/oauth2/revoke') {
      mock.revoked.push(req.postData() ?? '');
      return json(200, {});
    }
    return json(404, { message: 'not mocked' });
  });
  return mock;
}

export interface HelixApiCall {
  path: string;
  query: Record<string, string>;
  authorization: string;
  clientId: string;
}

export interface HelixApiMock {
  calls: HelixApiCall[];
}

export interface HelixApiOptions {
  /** Channels the account moderates (Get Moderated Channels). */
  moderated?: string[];
  mods?: string[];
  vips?: string[];
  /** Answer every call with this error instead. */
  error?: { status: number; message: string };
}

const API_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Client-Id', 'access-control-allow-methods': 'GET' };

/** A scripted api.twitch.tv (moderated channels, moderators, VIPs), with the CORS preflight the real one answers. */
export async function mockHelixApi(page: Page, opts: HelixApiOptions = {}): Promise<HelixApiMock> {
  const mock: HelixApiMock = { calls: [] };
  await page.route('https://api.twitch.tv/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: API_CORS });
    const url = new URL(req.url());
    const headers = req.headers();
    mock.calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: headers['authorization'] ?? '', clientId: headers['client-id'] ?? '' });
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...API_CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (opts.error) return json(opts.error.status, { error: 'Unauthorized', status: opts.error.status, message: opts.error.message });
    if (url.pathname === '/helix/moderation/channels') return json(200, { data: (opts.moderated ?? []).map((l) => ({ broadcaster_id: '9', broadcaster_login: l, broadcaster_name: l })) });
    if (url.pathname === '/helix/moderation/moderators') return json(200, { data: (opts.mods ?? []).map((l) => ({ user_id: '8', user_login: l, user_name: l })), pagination: {} });
    if (url.pathname === '/helix/channels/vips') return json(200, { data: (opts.vips ?? []).map((l) => ({ user_id: '7', user_login: l, user_name: l })), pagination: {} });
    return json(404, { message: 'not mocked' });
  });
  return mock;
}
