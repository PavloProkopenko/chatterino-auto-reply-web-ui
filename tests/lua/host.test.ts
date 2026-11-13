import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { luaSources } from './sources.ts';

let host: LuaHost;
beforeAll(async () => {
  host = await createLuaHost(luaSources());
});
afterAll(() => host.close());

type Cond = { type: string; match?: string };
const matches = (c: Cond, text: string, flags = 0, me = 'streamer') =>
  host.call('rules', 'matches_one', c, text, flags, me).then((r) => r[0] === true);

describe('rules.matches_one through WASM Lua', () => {
  const cases: [string, string, string, boolean][] = [
    ['keyword', 'донат', 'шо с донатами', true],
    ['keyword', 'донат', 'САМОДОНАТ', true],
    ['word', 'донат', 'шо с донатами', false],
    ['word', 'донат', 'нука, проверка, донат', true],
    ['word', 'донат', '(донат)', true],
    ['anyword', '!донат|!donate', 'ну !Донат пж', true],
    ['anyword', '!донат|!donate', '!донатик', false],
    ['anyword', 'играет', 'играет2', false],
    ['anyword', 'играет', 'играет-то', true],
    ['anyword', 'играет', 'неиграет', false],
    ['anyword', 'привіт', 'ПРИВІТ усім', true],
    ['pattern', '^!%a+$', '!song', true],
    ['pattern', '[', 'anything', false],
  ];
  test.each(cases)('%s %j on %j -> %s', async (type, match, text, expected) => {
    expect(await matches({ type, match }, text)).toBe(expected);
  });

  test('mention needs the account login', async () => {
    expect(await matches({ type: 'mention' }, 'эй @Streamer привет')).toBe(true);
    expect(await matches({ type: 'mention' }, 'эй всем привет')).toBe(false);
  });
});

describe('rules.validate', () => {
  test('rejects an empty keyword and accepts a normal one', async () => {
    expect((await host.call('rules', 'validate', 'word', ''))[0]).toBe(false);
    expect((await host.call('rules', 'validate', 'word', 'донат'))[0]).toBe(true);
  });
});

describe('names', () => {
  test('valid names, including Cyrillic', async () => {
    for (const n of ['donate', 'донат', 'a-b_c', 'x1y']) expect((await host.call('names', 'valid', n))[0]).toBe(true);
  });
  test.each([
    ['', 'пустым'],
    ['a'.repeat(21), '20'],
    ['12345', 'одна буква'],
    ['list', 'зарезервировано'],
    ['bad name', 'только буквы'],
  ])('invalid name %j', async (name, hint) => {
    const [ok, err] = await host.call('names', 'valid', name);
    expect(ok).toBe(false);
    expect(String(err)).toContain(hint);
  });
  test('check rejects a duplicate in the same list, case-insensitively', async () => {
    const list = [{ id: 1, name: 'Донат' }];
    const [ok, err] = await host.call('names', 'check', list, 'донат', 'rules');
    expect(ok).toBe(false);
    expect(String(err)).toContain('занято');
    expect((await host.call('names', 'check', list, 'другое', 'rules'))[0]).toBe(true);
  });
});

describe('util', () => {
  test.each([
    ['30m', 1800],
    ['1h30m', 5400],
    ['45s', 45],
    ['2d', 172800],
    ['', null],
    ['abc', null],
    ['0m', null],
  ])('parse_duration %j', async (s, expected) => {
    expect((await host.call('util', 'parse_duration', s))[0] ?? null).toBe(expected);
  });
});

describe('config.load sanitiser', () => {
  test('empty lists come back as {} (the plugin serializer quirk; normalising is the TS side), defaults are filled', async () => {
    const r = await host.sanitise('{"version":1,"channels":{},"ignore_users":{},"rules":{},"redeems":{}}');
    expect(r.warning).toBeNull();
    expect(r.config.channels).toEqual({});
    expect(r.config.redeems).toEqual({});
    expect(r.config.per_user_cooldown).toBe(60);
  });

  test('drops redeems without a valid timeout and timers without a started_at get disabled', async () => {
    const r = await host.sanitise(
      JSON.stringify({
        redeems: [
          { id: 1, channel: 'c', title: 't', action: 'timeout', seconds: 30, enabled: true },
          { id: 2, channel: 'c', title: 't', action: 'timeout', seconds: 99999999, enabled: true },
        ],
        timers: [
          { id: 1, channel: 'c', reply: 'прошло {time}', conditions: [{ type: 'word', match: 'старт' }], enabled: true },
        ],
      }),
    );
    expect((r.config.redeems as { id: number }[]).map((x) => x.id)).toEqual([1]);
    const t = (r.config.timers as { enabled: boolean; format: string; on_category: string }[])[0]!;
    expect(t.enabled).toBe(false);
    expect(t.format).toBe('smart');
    expect(t.on_category).toBe('reset');
  });

  test('a rule bound only to garbage channels is disabled, never widened to all channels', async () => {
    const r = await host.sanitise(
      JSON.stringify({ rules: [{ id: 1, enabled: true, reply: 'x', channels: ['bad name!'], conditions: [{ type: 'word', match: 'a' }] }] }),
    );
    const rule = (r.config.rules as { enabled: boolean; channels: string[] }[])[0]!;
    expect(rule.enabled).toBe(false);
    expect(rule.channels).toEqual({});
  });

  test('invalid duplicate names are dropped', async () => {
    const r = await host.sanitise(
      JSON.stringify({
        rules: [
          { id: 1, name: 'один', enabled: true, reply: 'x', conditions: [{ type: 'word', match: 'a' }] },
          { id: 2, name: 'ОДИН', enabled: true, reply: 'x', conditions: [{ type: 'word', match: 'b' }] },
        ],
      }),
    );
    const names = (r.config.rules as { name?: string }[]).map((x) => x.name);
    expect(names).toEqual(['один', undefined]);
  });

  test('corrupt JSON yields defaults, a warning and the bad copy', async () => {
    const r = await host.sanitise('{not json');
    expect(r.warning).toContain('corrupt');
    expect(r.badCopy).toBe('{not json');
    expect(r.config.version).toBe(1);
  });

  test('unknown keys survive the sanitiser', async () => {
    const r = await host.sanitise('{"future_feature":{"a":1},"version":1}');
    expect(r.config.future_feature).toEqual({ a: 1 });
  });
});
