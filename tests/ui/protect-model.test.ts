import { describe, expect, test } from 'vitest';
import { normalise, type Config } from '../../src/shared/config.ts';
import { applyFetched, parsePasted, rows, setAll, setProtected } from '../../src/ui/state/protect-model.ts';

const cfg = (extra: Record<string, unknown> = {}): Config => normalise({ protect_users: [], unprotect_users: [], ...extra });

describe('rows', () => {
  test('on = protected (in protect_users); off = an exception or simply not protected; sorted by login', () => {
    const c = cfg({ protect_users: ['b'], unprotect_users: ['c'] });
    expect(rows(['c', 'a', 'b'], c, [])).toEqual([
      { login: 'a', enabled: false, locked: false },
      { login: 'b', enabled: true, locked: false },
      { login: 'c', enabled: false, locked: false },
    ]);
  });
  test('an exception wins when a login is in both lists (a hand-edited file)', () => {
    expect(rows(['a'], cfg({ protect_users: ['a'], unprotect_users: ['a'] }), [])[0]!.enabled).toBe(false);
  });
  test('the owner and the account itself are always on and locked', () => {
    expect(rows(['streamer', 'me', 'x'], cfg(), ['streamer', 'me']).map((r) => [r.login, r.enabled, r.locked])).toEqual([
      ['me', true, true],
      ['streamer', true, true],
      ['x', false, false],
    ]);
  });
  test('duplicates collapse', () => {
    expect(rows(['a', 'a'], cfg(), [])).toHaveLength(1);
  });
});

describe('setProtected', () => {
  test('on: into protect_users, out of the exceptions', () => {
    const c = cfg({ unprotect_users: ['v'] });
    setProtected(c, 'v', true, []);
    expect(c.protect_users).toEqual(['v']);
    expect(c.unprotect_users).toEqual([]);
  });
  test('off: out of protect_users, into the exceptions (so a mod badge cannot protect them)', () => {
    const c = cfg({ protect_users: ['v', 'w'] });
    setProtected(c, 'v', false, []);
    expect(c.protect_users).toEqual(['w']);
    expect(c.unprotect_users).toEqual(['v']);
  });
  test('idempotent, both ways', () => {
    const c = cfg();
    setProtected(c, 'v', false, []);
    setProtected(c, 'v', false, []);
    expect(c.unprotect_users).toEqual(['v']);
    setProtected(c, 'v', true, []);
    setProtected(c, 'v', true, []);
    expect(c.protect_users).toEqual(['v']);
    expect(c.unprotect_users).toEqual([]);
  });
  test('a locked login (owner, the account) can be switched on but never turned off', () => {
    const c = cfg();
    setProtected(c, 'streamer', false, ['streamer']);
    expect(c.unprotect_users).toEqual([]);
    setProtected(c, 'streamer', true, ['streamer']);
    expect(c.protect_users).toEqual(['streamer']);
  });
  test('logins are stored in lower case', () => {
    const c = cfg();
    setProtected(c, 'MixedCase', true, []);
    expect(c.protect_users).toEqual(['mixedcase']);
  });
});

describe('applyFetched', () => {
  test('new people are protected by default; someone already an exception stays one; nobody is added twice', () => {
    const c = cfg({ protect_users: ['old'], unprotect_users: ['vip2'] });
    const added = applyFetched(c, ['old', 'vip1', 'vip2', 'vip1']);
    expect(added).toBe(1);
    expect(c.protect_users).toEqual(['old', 'vip1']);
    expect(c.unprotect_users).toEqual(['vip2']);
  });
  test('fetching again changes nothing', () => {
    const c = cfg();
    applyFetched(c, ['a', 'b']);
    const snapshot = structuredClone(c);
    expect(applyFetched(c, ['a', 'b'])).toBe(0);
    expect(c).toEqual(snapshot);
  });
});

describe('setAll', () => {
  test('on/off for a whole list at once, locked logins excepted', () => {
    const c = cfg();
    setAll(c, ['a', 'b', 'streamer'], false, ['streamer']);
    expect(c.unprotect_users.sort()).toEqual(['a', 'b']);
    setAll(c, ['a', 'b', 'streamer'], true, ['streamer']);
    expect(c.protect_users.sort()).toEqual(['a', 'b', 'streamer']);
    expect(c.unprotect_users).toEqual([]);
  });
});

describe('parsePasted', () => {
  test.each([
    ['The moderators of this channel are: Alice, bob_1, @Carol', ['alice', 'bob_1', 'carol']],
    ['The VIPs of this channel are: vip1, vip2.', ['vip1', 'vip2']],
    ['[12:34] system: The moderators of this channel are: a1, b2', ['a1', 'b2']],
    ['This channel does not have any moderators.', []],
    ['There are no VIPs in this channel.', []],
    ['alice, bob, carol', ['alice', 'bob', 'carol']],
    ['alice\nbob\n\ncarol', ['alice', 'bob', 'carol']],
    ['  @Alice  ', ['alice']],
    ['The moderators of this channel are: a, a, b', ['a', 'b']],
    ['', []],
    ['not a login!, ok_one, way_too_long_to_be_a_twitch_login_name', ['ok_one']],
  ])('%j -> %j', (text, expected) => expect(parsePasted(text)).toEqual(expected));
});
