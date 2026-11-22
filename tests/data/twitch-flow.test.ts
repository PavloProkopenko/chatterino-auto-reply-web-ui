import { describe, expect, test } from 'vitest';
import { TWITCH_SCOPES } from '../../src/shared/twitch.ts';
import { finishDeviceLogin, revokeToken, startDeviceLogin, type FlowDeps } from '../../src/ui/data/twitch-flow.ts';

type Reply = { status: number; body?: unknown } | Error;
interface Call { url: string; method: string; body: string; headers: Record<string, string> }

/** Scripted Twitch: replies per URL, consumed in order (the last one repeats). Time only moves when the flow sleeps. */
function fake(script: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const used: Record<string, number> = {};
  let t = 1_800_000_000_000;
  const sleeps: number[] = [];
  const deps: FlowDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? ''), headers: (init?.headers ?? {}) as Record<string, string> });
      const list = script[url];
      if (!list) throw new Error('unexpected request ' + url);
      const i = Math.min(used[url] ?? 0, list.length - 1);
      used[url] = (used[url] ?? 0) + 1;
      const r = list[i]!;
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
    }) as typeof fetch,
  };
  return { deps, calls, sleeps, advance: (ms: number) => (t += ms), now: () => t };
}

const DEVICE = 'https://id.twitch.tv/oauth2/device';
const TOKEN = 'https://id.twitch.tv/oauth2/token';
const VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const REVOKE = 'https://id.twitch.tv/oauth2/revoke';
const deviceOk = { status: 200, body: { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD', expires_in: 1800, interval: 5 } };
const pending = { status: 400, body: { status: 400, message: 'authorization_pending' } };
const tokenOk = { status: 200, body: { access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_in: 14000, scope: ['channel:read:redemptions'] } };
const validateOk = { status: 200, body: { client_id: 'cid', login: 'streamer', user_id: '1000', scopes: ['channel:read:redemptions', 'moderation:read'], expires_in: 14000 } };

describe('startDeviceLogin', () => {
  test('asks Twitch for a code with the client id and the scopes', async () => {
    const f = fake({ [DEVICE]: [deviceOk] });
    const r = await startDeviceLogin('cid1234567', f.deps);
    expect(r).toMatchObject({ status: 'ok', start: { userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate?device-code=ABCD', intervalMs: 5000 } });
    const body = new URLSearchParams(f.calls[0]!.body);
    expect(f.calls[0]!.method).toBe('POST');
    expect(body.get('client_id')).toBe('cid1234567');
    expect(body.get('scopes')).toBe(TWITCH_SCOPES);
  });
  test('refuses to show a link that is not on twitch.tv', async () => {
    const f = fake({ [DEVICE]: [{ status: 200, body: { ...deviceOk.body, verification_uri: 'https://evil.example/activate' } }] });
    expect(await startDeviceLogin('cid1234567', f.deps)).toMatchObject({ status: 'error' });
    const g = fake({ [DEVICE]: [{ status: 200, body: { ...deviceOk.body, verification_uri: 'http://www.twitch.tv/activate' } }] });
    expect(await startDeviceLogin('cid1234567', g.deps)).toMatchObject({ status: 'error' });
  });
  test('a Twitch error and a network error both become an error result', async () => {
    const a = fake({ [DEVICE]: [{ status: 400, body: { message: 'invalid client' } }] });
    expect(await startDeviceLogin('cid1234567', a.deps)).toEqual({ status: 'error', message: 'invalid client' });
    const b = fake({ [DEVICE]: [new TypeError('Failed to fetch')] });
    expect(await startDeviceLogin('cid1234567', b.deps)).toMatchObject({ status: 'error' });
  });
});

describe('finishDeviceLogin', () => {
  async function started(f: ReturnType<typeof fake>) {
    const s = await startDeviceLogin('cid1234567', f.deps);
    if (s.status !== 'ok') throw new Error('start failed');
    return s.start;
  }
  const ctl = () => new AbortController();

  test('waits while pending, then returns the stored shape with the account', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [pending, pending, tokenOk], [VALIDATE]: [validateOk] });
    const start = await started(f);
    const r = await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal);
    expect(r).toEqual({
      status: 'ok',
      login: { client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_at: Math.floor(f.now() / 1000) + 14000, user_id: '1000', login: 'streamer', scopes: ['channel:read:redemptions', 'moderation:read'] },
    });
    expect(f.sleeps).toEqual([5000, 5000, 5000]);
    const poll = new URLSearchParams(f.calls.filter((c) => c.url === TOKEN)[0]!.body);
    expect(poll.get('device_code')).toBe('DC');
    expect(poll.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(f.calls.find((c) => c.url === VALIDATE)!.headers.Authorization).toBe('OAuth AT-SECRET');
  });
  test('slow_down adds five seconds to the interval', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [{ status: 400, body: { message: 'slow_down' } }, tokenOk], [VALIDATE]: [validateOk] });
    const start = await started(f);
    await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal);
    expect(f.sleeps).toEqual([5000, 10000]);
  });
  test('the user says no', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [pending, { status: 400, body: { message: 'access_denied' } }] });
    const start = await started(f);
    expect(await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal)).toEqual({ status: 'denied' });
  });
  test('the code runs out', async () => {
    const f = fake({ [DEVICE]: [{ status: 200, body: { ...deviceOk.body, expires_in: 12 } }], [TOKEN]: [pending] });
    const start = await started(f);
    expect(await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal)).toEqual({ status: 'expired' });
    const g = fake({ [DEVICE]: [deviceOk], [TOKEN]: [{ status: 400, body: { message: 'invalid device code' } }] });
    expect(await finishDeviceLogin('cid1234567', await started(g), g.deps, ctl().signal)).toEqual({ status: 'expired' });
  });
  test('cancelling stops the polling without another request', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [pending] });
    const start = await started(f);
    const c = ctl();
    const run = finishDeviceLogin('cid1234567', start, { ...f.deps, sleep: async (ms) => { f.advance(ms); c.abort(); } }, c.signal);
    expect(await run).toEqual({ status: 'cancelled' });
    expect(f.calls.filter((x) => x.url === TOKEN)).toHaveLength(0);
  });
  test('errors never carry the token', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [tokenOk], [VALIDATE]: [{ status: 401, body: { message: 'invalid access token' } }] });
    const start = await started(f);
    const r = await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal);
    expect(r.status).toBe('error');
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  test('a network failure while polling is an error, not a crash', async () => {
    const f = fake({ [DEVICE]: [deviceOk], [TOKEN]: [new TypeError('Failed to fetch')] });
    const start = await started(f);
    expect(await finishDeviceLogin('cid1234567', start, f.deps, ctl().signal)).toMatchObject({ status: 'error' });
  });
});

describe('revokeToken', () => {
  test('posts client id and token, and never throws', async () => {
    const f = fake({ [REVOKE]: [{ status: 200 }] });
    await revokeToken('cid1234567', 'AT-SECRET', f.deps);
    const body = new URLSearchParams(f.calls[0]!.body);
    expect(body.get('client_id')).toBe('cid1234567');
    expect(body.get('token')).toBe('AT-SECRET');
    const g = fake({ [REVOKE]: [new TypeError('Failed to fetch')] });
    await expect(revokeToken('cid1234567', 'AT-SECRET', g.deps)).resolves.toBeUndefined();
  });
});
