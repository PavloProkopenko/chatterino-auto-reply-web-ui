import { describe, expect, test } from 'vitest';
import type { HelixStatus } from '../../src/ui/data/helix-file.ts';
import { ModCheck } from '../../src/ui/state/mod-check.svelte.ts';
import { ProtectFetch } from '../../src/ui/state/protect-fetch.svelte.ts';
import { MemoryDir } from '../data/memory-dir.ts';

const FILE = 'data/helix.json';
const LOGIN = { client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_at: 1_900_000_000, user_id: '1000', login: 'streamer', scopes: [] };
const status = (over: Partial<HelixStatus> = {}): HelixStatus => ({ loggedIn: true, login: 'streamer', clientId: 'cid1234567', userId: '1000', scopes: ['channel:read:redemptions', 'moderation:read', 'channel:read:vips', 'user:read:moderated_channels'], ...over });

type Reply = { status: number; body?: unknown } | Error;
function setup(handler: (url: URL) => Reply = () => ({ status: 200, body: { data: [] } }), opts: { files?: Record<string, string>; status?: () => HelixStatus | null; dir?: () => MemoryDir | null } = {}) {
  const dir = new MemoryDir(opts.files ?? { [FILE]: JSON.stringify(LOGIN) });
  const calls: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  let current: HelixStatus | null = status();
  const getStatus = opts.status ?? (() => current);
  const fetched: string[][] = [];
  const check = new ModCheck({ dir: opts.dir ?? (() => dir), fetch: fetchImpl, status: getStatus });
  const lists = new ProtectFetch({ dir: opts.dir ?? (() => dir), fetch: fetchImpl, status: getStatus, onFetched: (l) => void fetched.push(l) });
  return { check, lists, calls, fetched, dir, setStatus: (s: HelixStatus | null) => (current = s) };
}

describe('ModCheck', () => {
  test('the owner of the channel passes without asking Twitch', async () => {
    const s = setup();
    await s.check.run('Streamer');
    expect(s.check.result).toMatchObject({ channel: 'streamer', kind: 'owner' });
    expect(s.check.passes('streamer')).toBe(true);
    expect(s.calls).toHaveLength(0);
  });

  test('a moderator is found in the account\'s moderated channels (one request, for the account itself)', async () => {
    const s = setup(() => ({ status: 200, body: { data: [{ broadcaster_login: 'Other' }, { broadcaster_login: 'friend' }] } }));
    await s.check.run('friend');
    expect(s.check.result?.kind).toBe('moderator');
    expect(s.check.passes('friend')).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.pathname).toBe('/helix/moderation/channels');
    expect(s.calls[0]!.searchParams.get('user_id')).toBe('1000');
  });

  test('not a moderator there: does not pass', async () => {
    const s = setup(() => ({ status: 200, body: { data: [{ broadcaster_login: 'other' }] } }));
    await s.check.run('friend');
    expect(s.check.result?.kind).toBe('notModerator');
    expect(s.check.passes('friend')).toBe(false);
  });

  test('a login made before the scope existed asks for a new login, without any request', async () => {
    const s = setup(undefined, { status: () => status({ scopes: ['moderation:read'] }) });
    await s.check.run('friend');
    expect(s.check.result?.kind).toBe('needsRelogin');
    expect(s.calls).toHaveLength(0);
    expect(s.check.passes('friend')).toBe(false);
  });

  test('Twitch errors: a rejected scope asks for a new login, an old token and a lost connection say so', async () => {
    const scope = setup(() => ({ status: 401, body: { message: 'Missing scope: user:read:moderated_channels' } }));
    await scope.check.run('friend');
    expect(scope.check.result?.kind).toBe('needsRelogin');
    const old = setup(() => ({ status: 401, body: { message: 'Invalid OAuth token' } }));
    await old.check.run('friend');
    expect(old.check.result).toMatchObject({ kind: 'error', reason: 'expired' });
    const net = setup(() => new TypeError('Failed to fetch'));
    await net.check.run('friend');
    expect(net.check.result).toMatchObject({ kind: 'error', reason: 'network' });
    for (const s of [scope, old, net]) expect(JSON.stringify(s.check.result)).not.toContain('SECRET');
  });

  test('not logged in (no token in the file): an error, no request', async () => {
    const s = setup(undefined, { files: {} });
    await s.check.run('friend');
    expect(s.check.result).toMatchObject({ kind: 'error', reason: 'notLoggedIn' });
    expect(s.calls).toHaveLength(0);
  });

  test('a result belongs to one channel and one account: another channel, logout or another login all invalidate it', async () => {
    const s = setup(() => ({ status: 200, body: { data: [{ broadcaster_login: 'friend' }] } }));
    await s.check.run('friend');
    expect(s.check.passes('friend')).toBe(true);
    expect(s.check.passes('somebody')).toBe(false);
    s.setStatus(null);
    expect(s.check.passes('friend')).toBe(false);
    s.setStatus(status({ login: 'someone_else' }));
    expect(s.check.passes('friend')).toBe(false);
  });

  test('reset forgets the result; a check that is running is not started twice', async () => {
    const s = setup(() => ({ status: 200, body: { data: [{ broadcaster_login: 'friend' }] } }));
    const a = s.check.run('friend');
    const b = s.check.run('friend');
    await Promise.all([a, b]);
    expect(s.calls).toHaveLength(1);
    s.check.reset();
    expect(s.check.result).toBeNull();
    expect(s.check.passes('friend')).toBe(false);
  });
});

describe('ProtectFetch', () => {
  const mods = (u: URL): Reply =>
    u.pathname.endsWith('/moderators') ? { status: 200, body: { data: [{ user_login: 'Mod1' }, { user_login: 'mod2' }] } } : { status: 200, body: { data: [{ user_login: 'vip1' }] } };

  test('on the account\'s own channel: mods and VIPs come separately, with the account id as broadcaster', async () => {
    const s = setup(mods);
    await s.lists.fetch('streamer', 'mods');
    await s.lists.fetch('streamer', 'vips');
    expect(s.lists.entry('streamer', 'mods')).toMatchObject({ status: 'loaded', logins: ['mod1', 'mod2'] });
    expect(s.lists.entry('streamer', 'vips')).toMatchObject({ status: 'loaded', logins: ['vip1'] });
    expect(s.calls.map((u) => u.searchParams.get('broadcaster_id'))).toEqual(['1000', '1000']);
    expect(s.fetched).toEqual([['mod1', 'mod2'], ['vip1']]);
  });

  test('another channel: explained, no request (Twitch only answers the owner)', async () => {
    const s = setup(mods);
    await s.lists.fetch('friend', 'mods');
    expect(s.lists.entry('friend', 'mods')).toMatchObject({ status: 'error', error: { kind: 'notOwner' } });
    expect(s.calls).toHaveLength(0);
    expect(s.fetched).toEqual([]);
  });

  test('errors are kept per list and never carry the token', async () => {
    const s = setup(() => ({ status: 401, body: { message: 'Invalid OAuth token' } }));
    await s.lists.fetch('streamer', 'vips');
    expect(s.lists.entry('streamer', 'vips')).toMatchObject({ status: 'error', error: { kind: 'expired' } });
    expect(s.lists.entry('streamer', 'mods').status).toBe('idle');
    expect(JSON.stringify(s.lists.entry('streamer', 'vips'))).not.toContain('SECRET');
  });

  test('not logged in: an error and no request', async () => {
    const s = setup(mods, { files: {} });
    await s.lists.fetch('streamer', 'mods');
    expect(s.lists.entry('streamer', 'mods')).toMatchObject({ status: 'error', error: { kind: 'notLoggedIn' } });
    expect(s.calls).toHaveLength(0);
  });

  test('pasted chat output fills the same list and is reported like a fetch', async () => {
    const s = setup(mods);
    const n = s.lists.paste('friend', 'mods', 'The moderators of this channel are: Alice, bob');
    expect(n).toBe(2);
    expect(s.lists.entry('friend', 'mods')).toMatchObject({ status: 'loaded', logins: ['alice', 'bob'] });
    expect(s.fetched).toEqual([['alice', 'bob']]);
    expect(s.lists.paste('friend', 'mods', 'The moderators of this channel are: bob, carol')).toBe(2);
    expect(s.lists.entry('friend', 'mods').logins).toEqual(['alice', 'bob', 'carol']); // merged, not replaced
    expect(s.lists.paste('friend', 'vips', 'nothing useful here')).toBe(0);
    expect(s.lists.entry('friend', 'vips').status).toBe('idle');
  });

  test('a list is remembered per channel and kind, and reset clears them all', async () => {
    const s = setup(mods);
    await s.lists.fetch('streamer', 'mods');
    expect(s.lists.entry('streamer', 'mods').status).toBe('loaded');
    expect(s.lists.entry('other', 'mods').status).toBe('idle');
    s.lists.reset();
    expect(s.lists.entry('streamer', 'mods').status).toBe('idle');
  });

  test('loading is visible while a request runs, and a second click does not start another', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const dir = new MemoryDir({ [FILE]: JSON.stringify(LOGIN) });
    let n = 0;
    const lists = new ProtectFetch({
      dir: () => dir,
      status: () => status(),
      onFetched: () => undefined,
      fetch: (async () => {
        n += 1;
        await gate;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch,
    });
    const a = lists.fetch('streamer', 'mods');
    await new Promise((r) => setTimeout(r, 0));
    expect(lists.entry('streamer', 'mods').status).toBe('loading');
    void lists.fetch('streamer', 'mods');
    release();
    await a;
    expect(n).toBe(1);
    expect(lists.entry('streamer', 'mods').status).toBe('loaded');
  });
});
