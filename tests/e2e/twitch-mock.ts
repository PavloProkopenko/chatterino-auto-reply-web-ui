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
