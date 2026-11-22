import { describe, expect, test } from 'vitest';
import { HelixApiError, listMods, listVips, moderatedChannels, userByLogin } from '../../src/ui/data/helix-api.ts';
import type { HelixAuth } from '../../src/ui/data/helix-file.ts';

const auth: HelixAuth = { token: 'AT-SECRET', clientId: 'cid1234567', userId: '1000', login: 'streamer' };

interface Call { url: URL; headers: Record<string, string> }
type Reply = { status: number; body?: unknown } | Error;

/** Scripted api.twitch.tv: `routes` maps "path?after=cursor" (or just the path) to replies. */
function fake(handler: (url: URL) => Reply) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = handler(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { deps: { fetch: fetchImpl }, calls };
}
const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as HelixApiError;
  }
  throw new Error('did not throw');
};

describe('requests', () => {
  test('every call sends the bearer token and the client id, and asks only api.twitch.tv', async () => {
    const f = fake(() => ({ status: 200, body: { data: [] } }));
    await listMods(f.deps, auth, '1000');
    expect(f.calls[0]!.url.origin).toBe('https://api.twitch.tv');
    expect(f.calls[0]!.url.pathname).toBe('/helix/moderation/moderators');
    expect(f.calls[0]!.url.searchParams.get('broadcaster_id')).toBe('1000');
    expect(f.calls[0]!.url.searchParams.get('first')).toBe('100');
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer AT-SECRET');
    expect(f.calls[0]!.headers['Client-Id']).toBe('cid1234567');
  });
});

describe('lists', () => {
  test('mods and VIPs: lower-case logins, all pages followed with the cursor', async () => {
    const f = fake((u) => {
      if (u.pathname.endsWith('/moderators')) {
        return u.searchParams.get('after') === 'c1'
          ? { status: 200, body: { data: [{ user_login: 'Mod3' }], pagination: {} } }
          : { status: 200, body: { data: [{ user_login: 'Mod1' }, { user_login: 'MOD2' }], pagination: { cursor: 'c1' } } };
      }
      return { status: 200, body: { data: [{ user_login: 'Vip1' }], pagination: {} } };
    });
    expect(await listMods(f.deps, auth, '1000')).toEqual(['mod1', 'mod2', 'mod3']);
    expect(await listVips(f.deps, auth, '1000')).toEqual(['vip1']);
    expect(f.calls.map((c) => c.url.pathname)).toEqual(['/helix/moderation/moderators', '/helix/moderation/moderators', '/helix/channels/vips']);
  });
  test('rows without a login are skipped; an empty channel is an empty list', async () => {
    const f = fake(() => ({ status: 200, body: { data: [{ user_login: 'a' }, {}, { user_login: 5 }] } }));
    expect(await listVips(f.deps, auth, '1000')).toEqual(['a']);
    const g = fake(() => ({ status: 200, body: { data: [] } }));
    expect(await listMods(g.deps, auth, '1000')).toEqual([]);
  });
  test('a runaway cursor stops at 20 pages', async () => {
    const f = fake(() => ({ status: 200, body: { data: [{ user_login: 'x' }], pagination: { cursor: 'again' } } }));
    await listMods(f.deps, auth, '1000');
    expect(f.calls).toHaveLength(20);
  });
});

describe('moderated channels (the "am I a moderator there" check)', () => {
  test('asks for the account itself and returns the channel logins in lower case', async () => {
    const f = fake((u) =>
      u.searchParams.get('after') === 'c1'
        ? { status: 200, body: { data: [{ broadcaster_login: 'Third' }] } }
        : { status: 200, body: { data: [{ broadcaster_login: 'First' }, { broadcaster_login: 'second' }], pagination: { cursor: 'c1' } } },
    );
    expect(await moderatedChannels(f.deps, auth)).toEqual(['first', 'second', 'third']);
    expect(f.calls[0]!.url.pathname).toBe('/helix/moderation/channels');
    expect(f.calls[0]!.url.searchParams.get('user_id')).toBe('1000');
  });
});

describe('userByLogin', () => {
  test('finds the id of a channel, or null when there is no such account', async () => {
    const f = fake((u) => (u.searchParams.get('login') === 'nobody' ? { status: 200, body: { data: [] } } : { status: 200, body: { data: [{ id: '42', login: 'Chan' }] } }));
    expect(await userByLogin(f.deps, auth, 'chan')).toEqual({ id: '42', login: 'chan' });
    expect(await userByLogin(f.deps, auth, 'nobody')).toBeNull();
  });
});

describe('errors', () => {
  const message = (status: number, text: string) => fake(() => ({ status, body: { error: 'Unauthorized', status, message: text } }));
  test.each([
    [401, "The ID in broadcaster_id must match the user ID found in the request's OAuth token.", 'notOwner'],
    [401, 'The user access token must include the channel:read:vips or channel:manage:vips scope.', 'scope'],
    [401, 'Missing scope: user:read:moderated_channels', 'scope'],
    [401, 'Invalid OAuth token', 'expired'],
    [401, 'OAuth token is missing', 'expired'],
    [403, 'Forbidden', 'scope'],
    [500, 'Internal Server Error', 'other'],
  ])('HTTP %i "%s" is %s', async (status, text, kind) => {
    const f = message(status, text);
    const e = await err(listVips(f.deps, auth, '1000'));
    expect(e).toBeInstanceOf(HelixApiError);
    expect(e.kind).toBe(kind);
  });
  test('an unrecognised 401 is treated as an expired token', async () => {
    const e = await err(listMods(message(401, 'something new').deps, auth, '1000'));
    expect(e.kind).toBe('expired');
  });
  test('a network failure is its own kind', async () => {
    const e = await err(listMods(fake(() => new TypeError('Failed to fetch')).deps, auth, '1000'));
    expect(e.kind).toBe('network');
  });
  test('no error ever carries the token or the client id', async () => {
    for (const f of [message(401, 'Invalid OAuth token'), message(500, 'boom'), fake(() => new TypeError('Failed to fetch'))]) {
      const e = await err(listMods(f.deps, auth, '1000'));
      expect(e.message + JSON.stringify(e)).not.toContain('SECRET');
      expect(e.message).not.toContain('cid1234567');
    }
  });
});
