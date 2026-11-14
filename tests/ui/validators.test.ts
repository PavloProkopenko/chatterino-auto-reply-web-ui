import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import type { LuaClient } from '../../src/lua/client.ts';
import { channelValidator, checkSeconds, userValidator } from '../../src/ui/state/validators.ts';
import { luaSources } from '../lua/sources.ts';

let host: LuaHost;
let lua: LuaClient;
beforeAll(async () => {
  host = await createLuaHost(luaSources());
  lua = { call: (m, f, ...a) => host.call(m, f, ...a), sanitise: (r) => host.sanitise(r), close: () => host.close() };
});
afterAll(() => host.close());

describe('channelValidator (the plugin\'s parse_channels)', () => {
  test('accepts a login, lowercases it and strips #', async () => {
    const v = channelValidator(lua);
    expect(await v('Streamer')).toEqual({ ok: true, value: 'streamer' });
    expect(await v('#my_channel1')).toEqual({ ok: true, value: 'my_channel1' });
  });
  test('rejects names the plugin rejects, with the plugin\'s own message', async () => {
    const v = channelValidator(lua);
    const bad = await v('bad name!');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('неверное имя канала');
    expect((await v('канал')).ok).toBe(false);
    expect((await v('a'.repeat(26))).ok).toBe(false);
  });
  test('"all" and "here" are not channel logins', async () => {
    const v = channelValidator(lua);
    expect((await v('all')).ok).toBe(false);
    expect((await v('here')).ok).toBe(false);
  });
});

describe('userValidator (parse_skip)', () => {
  test('accepts a login and lowercases it, strips @', async () => {
    const v = userValidator(lua);
    expect(await v('@Vasya_1')).toEqual({ ok: true, value: 'vasya_1' });
  });
  test('rejects bad names and the mods/nomods keywords', async () => {
    const v = userValidator(lua);
    expect((await v('вася')).ok).toBe(false);
    expect((await v('mods')).ok).toBe(false);
    expect((await v('nomods')).ok).toBe(false);
    expect((await v('a b')).ok).toBe(false);
  });
});

describe('checkSeconds', () => {
  test.each([
    ['60', 0, 86400, { ok: true, value: 60 }],
    [' 5 ', 0, 86400, { ok: true, value: 5 }],
    ['0', 0, 86400, { ok: true, value: 0 }],
    ['86400', 0, 86400, { ok: true, value: 86400 }],
  ])('%j is valid', (text, min, max, expected) => expect(checkSeconds(text, min, max)).toEqual(expected));
  test.each([['', 0], ['abc', 0], ['-1', 0], ['1.5', 0], ['1e3', 0], ['86401', 0], ['0', 1]])('%j is rejected (min %i)', (text, min) => {
    expect(checkSeconds(text, min, 86400).ok).toBe(false);
  });
});
