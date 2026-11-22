import { describe, expect, test } from 'vitest';
import { TwitchState } from '../../src/ui/state/twitch.svelte.ts';
import type { PluginDir } from '../../src/ui/data/ports.ts';
import { MemoryDir } from '../data/memory-dir.ts';

const DEVICE = 'https://id.twitch.tv/oauth2/device';
const TOKEN = 'https://id.twitch.tv/oauth2/token';
const VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const REVOKE = 'https://id.twitch.tv/oauth2/revoke';
const device = { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD', expires_in: 1800, interval: 5 };
const token = { access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_in: 14000 };
const who = { login: 'Streamer', user_id: '1000', scopes: ['moderation:read'] };
type Reply = { status: number; body?: unknown };

function setup(opts: { files?: Record<string, string>; script?: Record<string, Reply[]>; clientId?: string; dir?: () => PluginDir | null } = {}) {
  const dir = new MemoryDir(opts.files ?? {});
  const calls: string[] = [];
  const script = opts.script ?? { [DEVICE]: [{ status: 200, body: device }], [TOKEN]: [{ status: 200, body: token }], [VALIDATE]: [{ status: 200, body: who }], [REVOKE]: [{ status: 200 }] };
  const used: Record<string, number> = {};
  let enabled = 0;
  let t = 1_800_000_000_000;
  let release: (() => void) | null = null;
  const state = new TwitchState({
    dir: opts.dir ?? (() => dir),
    clientId: opts.clientId ?? 'cid1234567',
    enableHelix: () => void enabled++,
    now: () => t,
    // the first sleep (before the first poll) can be held, so a test can look at the "waiting" screen
    sleep: async (ms, signal) => {
      t += ms;
      if (hold)
        await new Promise<void>((r) => {
          release = r;
          signal.addEventListener('abort', () => r()); // like the real sleep
        });
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url} ${String(init?.body ?? '')}`);
      const list = script[url];
      if (!list) throw new Error('unexpected ' + url);
      const i = Math.min(used[url] ?? 0, list.length - 1);
      used[url] = (used[url] ?? 0) + 1;
      return new Response(JSON.stringify(list[i]!.body ?? {}), { status: list[i]!.status });
    }) as typeof fetch,
  });
  let hold = false;
  return { state, dir, calls, enabled: () => enabled, hold: () => (hold = true), unhold: () => { hold = false; release?.(); } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('TwitchState', () => {
  test('refresh reads the status from helix.json', async () => {
    const s = setup({ files: { 'data/helix.json': JSON.stringify({ client_id: 'cid1234567', access_token: 'AT-SECRET', login: 'streamer' }) } });
    expect(s.state.status).toBeNull();
    await s.state.refresh();
    expect(s.state.status).toEqual({ loggedIn: true, login: 'streamer', clientId: 'cid1234567', userId: null, scopes: [] });
    expect(s.state.loggedIn).toBe(true);
  });

  test('login: shows the code while waiting, then saves the login, switches helix on and goes idle', async () => {
    const s = setup();
    s.hold();
    const done = s.state.login();
    await settle();
    expect(s.state.phase).toBe('waiting');
    expect(s.state.code).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate?device-code=ABCD' });
    s.unhold();
    await done;
    expect(s.state.phase).toBe('idle');
    expect(s.state.code).toBeNull();
    expect(s.state.error).toBeNull();
    expect(s.state.status).toEqual({ loggedIn: true, login: 'streamer', clientId: 'cid1234567', userId: '1000', scopes: ['moderation:read'] });
    expect(s.enabled()).toBe(1);
    expect(JSON.parse((await s.dir.read('data/helix.json'))!)).toMatchObject({ access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', login: 'streamer', client_id: 'cid1234567' });
  });

  test('no token ever reaches reactive state', async () => {
    const s = setup();
    await s.state.login();
    const visible = JSON.stringify({ status: s.state.status, phase: s.state.phase, code: s.state.code, error: s.state.error });
    expect(visible).not.toContain('SECRET');
  });

  test('the client id stored in helix.json wins over the built-in one; with neither there is a clear error and no request', async () => {
    const own = setup({ files: { 'data/helix.json': JSON.stringify({ client_id: 'storedid1234' }) }, clientId: 'builtin12345' });
    await own.state.login();
    expect(own.calls[0]).toContain('client_id=storedid1234');
    const none = setup({ clientId: '' });
    await none.state.login();
    expect(none.state.error).toEqual({ kind: 'noClientId' });
    expect(none.calls).toEqual([]);
  });

  test('no plugin folder (demo, opened file): a clear error and no request', async () => {
    const s = setup({ dir: () => null });
    await s.state.login();
    expect(s.state.error).toEqual({ kind: 'noFolder' });
    expect(s.calls).toEqual([]);
  });

  test.each([
    ['denied', { status: 400, body: { message: 'access_denied' } }, { kind: 'denied' }],
    ['expired', { status: 400, body: { message: 'invalid device code' } }, { kind: 'expired' }],
  ])('%s is reported and leaves nothing behind', async (_n, reply, error) => {
    const s = setup({ script: { [DEVICE]: [{ status: 200, body: device }], [TOKEN]: [reply as Reply] } });
    await s.state.login();
    expect(s.state.error).toEqual(error);
    expect(s.state.phase).toBe('idle');
    expect(await s.dir.read('data/helix.json')).toBeNull();
    expect(s.enabled()).toBe(0);
  });

  test('Twitch down at the start: failed with the reason', async () => {
    const s = setup({ script: { [DEVICE]: [{ status: 400, body: { message: 'invalid client' } }] } });
    await s.state.login();
    expect(s.state.error).toEqual({ kind: 'failed', message: 'invalid client' });
  });

  test('cancel while waiting: back to idle, no error, nothing written', async () => {
    const s = setup();
    s.hold();
    const done = s.state.login();
    await settle();
    s.state.cancel();
    s.unhold();
    await done;
    expect(s.state.phase).toBe('idle');
    expect(s.state.error).toBeNull();
    expect(s.state.code).toBeNull();
    expect(await s.dir.read('data/helix.json')).toBeNull();
  });

  test('a file that cannot be written is reported as such', async () => {
    const s = setup();
    s.dir.failWritesTo = /helix\.json$/;
    await s.state.login();
    expect(s.state.error).toEqual({ kind: 'saveFailed' });
    expect(s.state.status?.loggedIn ?? false).toBe(false);
    expect(s.enabled()).toBe(0);
  });

  test('a second login while one is running is ignored', async () => {
    const s = setup();
    s.hold();
    const first = s.state.login();
    await settle();
    await s.state.login();
    s.unhold();
    await first;
    expect(s.calls.filter((c) => c.includes('/oauth2/device'))).toHaveLength(1);
  });

  test('cancel then login again at once: the old run does not reset the new one', async () => {
    const s = setup();
    s.hold();
    const first = s.state.login();
    await settle();
    s.state.cancel();
    const second = s.state.login(); // starts while the first is still unwinding
    await first;
    expect(['starting', 'waiting']).toContain(s.state.phase); // the second login, not reset by the first one unwinding
    s.unhold();
    await second;
    expect(s.state.status?.loggedIn).toBe(true);
    expect(s.state.phase).toBe('idle');
  });

  test('logout clears the file, revokes at Twitch and keeps the client id', async () => {
    const s = setup({ files: { 'data/helix.json': JSON.stringify({ client_id: 'cid1234567', access_token: 'AT-SECRET', login: 'streamer' }) } });
    await s.state.refresh();
    await s.state.logout();
    expect(s.state.status).toEqual({ loggedIn: false, login: null, clientId: 'cid1234567', userId: null, scopes: [] });
    expect(JSON.parse((await s.dir.read('data/helix.json'))!)).toEqual({ client_id: 'cid1234567' });
    expect(s.calls.some((c) => c.includes('/oauth2/revoke') && c.includes('token=AT-SECRET'))).toBe(true);
  });

  test('another folder (or none) resets everything, including a running login', async () => {
    let dir: PluginDir | null = new MemoryDir({ 'data/helix.json': JSON.stringify({ client_id: 'cid1234567', access_token: 'A', login: 'streamer' }) });
    const s = setup({ dir: () => dir });
    await s.state.refresh();
    expect(s.state.loggedIn).toBe(true);
    dir = null;
    await s.state.refresh();
    expect(s.state.status).toBeNull();
    expect(s.state.loggedIn).toBe(false);
  });
});
