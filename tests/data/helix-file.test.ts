import { describe, expect, test } from 'vitest';
import type { FlowDeps, StoredLogin } from '../../src/ui/data/twitch-flow.ts';
import { clearHelixLogin, logoutHelix, readHelixStatus, withHelixToken, writeHelixLogin } from '../../src/ui/data/helix-file.ts';
import { MemoryDir } from './memory-dir.ts';

const FILE = 'data/helix.json';
const login: StoredLogin = { client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_at: 1_800_003_600, user_id: '1000', login: 'streamer', scopes: ['moderation:read'] };
const parsed = async (dir: MemoryDir) => JSON.parse((await dir.read(FILE))!) as Record<string, unknown>;

describe('readHelixStatus', () => {
  test('no file, empty file, garbage: logged out, nothing thrown', async () => {
    expect(await readHelixStatus(new MemoryDir())).toEqual({ loggedIn: false, login: null, clientId: null, userId: null, scopes: [] });
    expect(await readHelixStatus(new MemoryDir({ [FILE]: '' }))).toEqual({ loggedIn: false, login: null, clientId: null, userId: null, scopes: [] });
    expect(await readHelixStatus(new MemoryDir({ [FILE]: '{ not json' }))).toEqual({ loggedIn: false, login: null, clientId: null, userId: null, scopes: [] });
    expect(await readHelixStatus(new MemoryDir({ [FILE]: '[1,2]' }))).toEqual({ loggedIn: false, login: null, clientId: null, userId: null, scopes: [] });
  });
  test('a stored login is reported without any token', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify(login) });
    const status = await readHelixStatus(dir);
    expect(status).toEqual({ loggedIn: true, login: 'streamer', clientId: 'cid1234567', userId: '1000', scopes: ['moderation:read'] });
    expect(JSON.stringify(status)).not.toContain('SECRET');
  });
  test('only a client id (set by `helix clientid` in chat) is not a login', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify({ client_id: 'cid1234567' }) });
    expect(await readHelixStatus(dir)).toEqual({ loggedIn: false, login: null, clientId: 'cid1234567', userId: null, scopes: [] });
  });
});

describe('withHelixToken', () => {
  test('hands the token to the callback for that one call and returns only what the callback returns', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify(login) });
    let seen: unknown = null;
    const out = await withHelixToken(dir, async (auth) => {
      seen = auth;
      return 'result';
    });
    expect(out).toEqual({ status: 'ok', value: 'result' });
    expect(seen).toEqual({ token: 'AT-SECRET', clientId: 'cid1234567', userId: '1000', login: 'streamer' });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
  test('not logged in: the callback is never called', async () => {
    let called = false;
    const cases: Record<string, string>[] = [{}, { [FILE]: JSON.stringify({ client_id: 'cid1234567' }) }, { [FILE]: '{ nope' }];
    for (const files of cases) {
      const out = await withHelixToken(new MemoryDir(files), async () => void (called = true));
      expect(out).toEqual({ status: 'notLoggedIn' });
    }
    expect(called).toBe(false);
  });
  test('a login without a client id or user id cannot call Twitch', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify({ access_token: 'AT-SECRET', login: 'streamer' }) });
    expect(await withHelixToken(dir, async () => 1)).toEqual({ status: 'notLoggedIn' });
  });
  test('the file is not changed by reading the token', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify(login) });
    const before = await dir.read(FILE);
    await withHelixToken(dir, async () => 1);
    expect(await dir.read(FILE)).toBe(before);
  });
});

describe('writeHelixLogin', () => {
  test('creates the file in data/ with the keys the plugin reads', async () => {
    const dir = new MemoryDir();
    await writeHelixLogin(dir, login);
    expect(await parsed(dir)).toEqual(login);
  });
  test('keeps keys it does not know and replaces the old login', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify({ client_id: 'old', access_token: 'OLD', login: 'someone', future_key: { a: 1 } }) });
    await writeHelixLogin(dir, login);
    expect(await parsed(dir)).toEqual({ ...login, future_key: { a: 1 } });
  });
  test('a corrupt file is replaced, not an obstacle', async () => {
    const dir = new MemoryDir({ [FILE]: '{ half' });
    await writeHelixLogin(dir, login);
    expect(await parsed(dir)).toEqual(login);
  });
  test('a failed write throws, so the UI can say so', async () => {
    const dir = new MemoryDir();
    dir.failWritesTo = /helix\.json$/;
    await expect(writeHelixLogin(dir, login)).rejects.toThrow();
  });
});

describe('clearHelixLogin', () => {
  test('removes the token and account, keeps the client id and unknown keys', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify({ ...login, future_key: 7 }) });
    await clearHelixLogin(dir);
    expect(await parsed(dir)).toEqual({ client_id: 'cid1234567', future_key: 7 });
  });
  test('nothing to clear: does not create the file', async () => {
    const dir = new MemoryDir();
    await clearHelixLogin(dir);
    expect(await dir.read(FILE)).toBeNull();
  });
});

describe('logoutHelix', () => {
  const noopDeps = (calls: string[]): FlowDeps => ({
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${String(url)} ${String(init?.body)}`);
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  test('clears the file first, then revokes the token at Twitch', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify(login) });
    const calls: string[] = [];
    await logoutHelix(dir, noopDeps(calls));
    expect(await parsed(dir)).toEqual({ client_id: 'cid1234567' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/oauth2/revoke');
    expect(calls[0]).toContain('token=AT-SECRET');
  });
  test('not logged in: no request at all', async () => {
    const calls: string[] = [];
    await logoutHelix(new MemoryDir({ [FILE]: JSON.stringify({ client_id: 'cid1234567' }) }), noopDeps(calls));
    expect(calls).toEqual([]);
  });
  test('an offline revoke still logs out locally', async () => {
    const dir = new MemoryDir({ [FILE]: JSON.stringify(login) });
    await logoutHelix(dir, { fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch });
    expect(await parsed(dir)).toEqual({ client_id: 'cid1234567' });
  });
});
