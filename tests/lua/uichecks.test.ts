import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { analyseRules, checkCondition, previewRules, suggestName } from '../../src/ui/state/rule-checks.ts';
import type { Rule } from '../../src/shared/config.ts';
import { luaSources } from './sources.ts';

let host: LuaHost;
beforeAll(async () => {
  host = await createLuaHost(luaSources());
});
afterAll(() => host.close());

const r = (id: number, reply: string, conditions: Rule['conditions'], more: Partial<Rule> = {}): Rule => ({ id, enabled: true, reply, channels: [], conditions, ...more });
const word = (m: string) => ({ type: 'word', match: m });

describe('analyseRules', () => {
  test('a good rule has no findings', async () => {
    const a = await analyseRules(host, [r(1, 'Привет, {user}!', [word('привет')])], 'me');
    expect(a.get(1)).toEqual({ id: 1 });
  });

  test('reply problems come from the plugin\'s rules', async () => {
    const a = await analyseRules(
      host,
      [r(1, '', [word('a')]), r(2, '/ban x', [word('a')]), r(3, '.me hi', [word('a')]), r(4, 'x'.repeat(501), [word('a')]), r(5, 'x'.repeat(500), [word('a')])],
      'me',
    );
    for (const id of [1, 2, 3, 4]) expect(a.get(id)?.replyError, `rule ${id}`).toBeTruthy();
    expect(a.get(5)?.replyError).toBeUndefined();
  });

  test('conditions are validated by rules.validate', async () => {
    const a = await analyseRules(
      host,
      [r(1, 'x', [word('')]), r(2, 'x', [{ type: 'flag', match: 'nope' }]), r(3, 'x', [{ type: 'pattern', match: '[' }]), r(4, 'x', [{ type: 'mention' }]), r(5, 'x', [{ type: 'flag', match: 'first' }])],
      'me',
    );
    for (const id of [1, 2, 3]) expect(a.get(id)?.conditionError, `rule ${id}`).toBeTruthy();
    for (const id of [4, 5]) expect(a.get(id)?.conditionError).toBeUndefined();
  });

  test('names: format, reserved words and duplicates (case-insensitive) come from the plugin\'s names module', async () => {
    const a = await analyseRules(
      host,
      [r(1, 'x', [word('a')], { name: 'greet' }), r(2, 'x', [word('b')], { name: 'GREET' }), r(3, 'x', [word('c')], { name: 'bad name!' }), r(4, 'x', [word('d')], { name: 'okname' })],
      'me',
    );
    expect(a.get(2)?.nameError).toBeTruthy();
    expect(a.get(3)?.nameError).toBeTruthy();
    expect(a.get(4)?.nameError).toBeUndefined();
  });

  test('an earlier rule that wins the later rule\'s own sample text shadows it', async () => {
    const a = await analyseRules(host, [r(1, 'a', [{ type: 'keyword', match: 'донат' }]), r(2, 'b', [word('донат')]), r(3, 'c', [word('привет')])], 'me');
    expect(a.get(2)?.shadowedBy).toBe(1);
    expect(a.get(1)?.shadowedBy).toBeUndefined();
    expect(a.get(3)?.shadowedBy).toBeUndefined();
  });

  test('a disabled or broken earlier rule shadows nothing; neither does a later rule that is off', async () => {
    const a = await analyseRules(
      host,
      [r(1, 'a', [word('x')], { enabled: false }), r(2, 'b', [word('x')]), r(3, '', [word('y')]), r(4, 'd', [word('y')]), r(5, 'e', [word('x')], { enabled: false })],
      'me',
    );
    expect(a.get(2)?.shadowedBy).toBeUndefined();
    expect(a.get(4)?.shadowedBy).toBeUndefined();
    expect(a.get(5)?.shadowedBy).toBeUndefined();
  });

  test('rules for different channels do not shadow each other; a global rule above a scoped one does; the reverse does not', async () => {
    const a = await analyseRules(
      host,
      [
        r(1, 'a', [word('x')], { channels: ['one'] }),
        r(2, 'b', [word('x')], { channels: ['two'] }),
        r(3, 'c', [word('x')]), // a scoped rule above only wins in its own channel: no claim
        r(4, 'd', [word('y')]),
        r(5, 'e', [word('y')], { channels: ['one'] }),
      ],
      'me',
    );
    expect(a.get(2)?.shadowedBy).toBeUndefined();
    expect(a.get(3)?.shadowedBy).toBeUndefined();
    expect(a.get(5)?.shadowedBy).toBe(4);
  });

  test('flags and mentions can be sampled; patterns cannot, so no claim is made', async () => {
    const a = await analyseRules(
      host,
      [r(1, 'a', [{ type: 'flag', match: 'first' }]), r(2, 'b', [{ type: 'flag', match: 'first' }]), r(3, 'c', [{ type: 'pattern', match: '^!%a+$' }]), r(4, 'd', [{ type: 'pattern', match: '^!%a+$' }])],
      'me',
    );
    expect(a.get(2)?.shadowedBy).toBe(1);
    expect(a.get(4)?.shadowedBy).toBeUndefined();
  });
});

describe('checkCondition', () => {
  test('returns the plugin\'s message, or null when fine', async () => {
    expect(await checkCondition(host, 'word', 'привет')).toBeNull();
    expect(await checkCondition(host, 'mention')).toBeNull();
    expect(await checkCondition(host, 'word', '')).toContain('нужен');
    expect(await checkCondition(host, 'anyword', '|')).toBeTruthy();
  });
});

describe('previewRules', () => {
  const list = [
    r(1, 'Донат: {user}', [{ type: 'anyword', match: '!донат|!donate' }]),
    r(2, 'Привет, {user}!', [word('привет')]),
    r(3, 'Добро пожаловать', [{ type: 'flag', match: 'first' }]),
    r(4, 'Только тут', [word('секрет')], { channels: ['other'] }),
    r(5, 'Слушаю', [{ type: 'mention' }]),
    r(6, 'Выключено', [word('выкл')], { enabled: false }),
  ];
  const base = { text: '', channel: 'main', flags: [] as string[], me: 'streamer' };

  test('the first matching rule wins', async () => {
    const p = await previewRules(host, list, { ...base, text: 'Привет всем !донат' });
    expect(p.winner).toBe(1);
    expect(p.rows.find((x) => x.id === 2)?.matched).toBe(true);
  });

  test('Cyrillic case and word boundaries follow the plugin', async () => {
    expect((await previewRules(host, list, { ...base, text: 'ПРИВЕТ' })).winner).toBe(2);
    expect((await previewRules(host, list, { ...base, text: 'приветствую' })).winner).toBeNull();
  });

  test('flags and mention', async () => {
    expect((await previewRules(host, list, { ...base, text: 'hello', flags: ['first'] })).winner).toBe(3);
    expect((await previewRules(host, list, { ...base, text: 'hello' })).winner).toBeNull();
    expect((await previewRules(host, list, { ...base, text: '@Streamer hi' })).winner).toBe(5);
    expect((await previewRules(host, list, { ...base, text: '@streamer hi', me: '' })).winner).toBeNull();
  });

  test('channel scope and disabled rules', async () => {
    expect((await previewRules(host, list, { ...base, text: 'секрет' })).winner).toBeNull();
    const p = await previewRules(host, list, { ...base, text: 'секрет', channel: 'other' });
    expect(p.winner).toBe(4);
    expect((await previewRules(host, list, { ...base, text: 'выкл' })).winner).toBeNull();
    expect(p.rows.find((x) => x.id === 6)).toMatchObject({ active: false });
  });

  test('a rule with an invalid condition never fires', async () => {
    const bad = [r(1, 'x', [{ type: 'flag', match: 'nope' }])];
    expect((await previewRules(host, bad, { ...base, text: 'anything' })).winner).toBeNull();
  });
});

describe('suggestName', () => {
  test('the first free candidate; a taken one is skipped', async () => {
    expect(await suggestName(host, [], 'Привет, {user}! Как дела')).toBe('Привет');
    expect(await suggestName(host, [r(1, 'x', [word('a')], { name: 'привет' })], 'Привет, {user}! Как дела')).not.toBe('Привет');
    expect(await suggestName(host, [], '!!! 123')).toBeNull();
  });
});
