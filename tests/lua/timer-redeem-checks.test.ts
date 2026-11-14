import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import type { Redeem, Rule, Timer } from '../../src/shared/config.ts';
import { analyseRedeems, analyseTimers, elapsedExample, parseDuration, previewAll } from '../../src/ui/state/timer-checks.ts';
import { durationText } from '../../src/ui/state/duration.ts';
import { luaSources } from './sources.ts';

let host: LuaHost;
beforeAll(async () => {
  host = await createLuaHost(luaSources());
});
afterAll(() => host.close());

const word = (match: string) => ({ type: 'word', match });
const t = (id: number, more: Partial<Timer> = {}): Timer => ({ id, channel: 'main', reply: 'идёт {time}', format: 'smart', on_category: 'reset', conditions: [word('!game')], enabled: false, ...more });
const rd = (id: number, more: Partial<Redeem> = {}): Redeem => ({ id, channel: 'main', title: `Награда ${id}`, action: 'timeout', seconds: 600, enabled: true, ...more });
const r = (id: number, reply: string, conditions: object[], more: Partial<Rule> = {}): Rule => ({ id, enabled: true, reply, channels: [], conditions, ...more }) as Rule;

describe('analyseTimers', () => {
  test('a good timer has no findings', async () => {
    expect((await analyseTimers(host, [t(1)], 'me')).get(1)).toEqual({ id: 1 });
  });

  test('the reply needs {time}, text, and no leading slash', async () => {
    const a = await analyseTimers(host, [t(1, { reply: 'без времени' }), t(2, { reply: '' }), t(3, { reply: '/x {time}' }), t(4, { reply: '{time}' })], 'me');
    expect(a.get(1)?.replyError).toContain('{time}');
    expect(a.get(2)?.replyError).toBeTruthy();
    expect(a.get(3)?.replyError).toBeTruthy();
    expect(a.get(4)?.replyError).toBeUndefined();
  });

  test('conditions come from rules.validate, names from names.check with the timers list', async () => {
    const a = await analyseTimers(
      host,
      [t(1, { conditions: [word('')] }), t(2, { conditions: [{ type: 'flag', match: 'nope' }] }), t(3, { name: 'game' }), t(4, { name: 'GAME' }), t(5, { name: 'bad name!' }), t(6, { name: 'okname' })],
      'me',
    );
    expect(a.get(1)?.conditionError).toBeTruthy();
    expect(a.get(2)?.conditionError).toBeTruthy();
    expect(a.get(3)?.nameError).toContain('занято'); // the plugin reports both items that share a name
    expect(a.get(4)?.nameError).toContain('занято');
    expect(a.get(5)?.nameError).toBeTruthy();
    expect(a.get(6)?.nameError).toBeUndefined();
  });

  test('an earlier timer on the same channel that wins the later one\'s sample shadows it; other channels do not', async () => {
    const a = await analyseTimers(
      host,
      [t(1, { conditions: [{ type: 'keyword', match: 'game' }] }), t(2, { conditions: [word('game')] }), t(3, { channel: 'other', conditions: [word('game')] }), t(4, { conditions: [word('время')] })],
      'me',
    );
    expect(a.get(2)?.shadowedBy).toBe(1);
    expect(a.get(3)?.shadowedBy).toBeUndefined();
    expect(a.get(4)?.shadowedBy).toBeUndefined();
  });

  test('a legacy timer with only a trigger word is understood', async () => {
    const legacy = { id: 1, channel: 'main', reply: '{time}', format: 'smart', on_category: 'reset', trigger: '!game', enabled: false } as unknown as Timer;
    expect((await analyseTimers(host, [legacy], 'me')).get(1)).toEqual({ id: 1 });
  });
});

describe('analyseRedeems', () => {
  test('a good redeem has no findings; unmute needs no duration', async () => {
    const a = await analyseRedeems(host, [rd(1), rd(2, { action: 'untimeout', seconds: undefined })]);
    expect(a.get(1)).toEqual({ id: 1 });
    expect(a.get(2)).toEqual({ id: 2 });
  });

  test('title, duration range and name', async () => {
    const a = await analyseRedeems(host, [
      rd(1, { title: '  ' }),
      rd(2, { seconds: 0 }),
      rd(3, { seconds: 1_209_601 }),
      rd(4, { seconds: 1_209_600 }),
      rd(5, { seconds: undefined }),
      rd(6, { name: 'strike' }),
      rd(7, { name: 'STRIKE', title: 'Другая' }),
      rd(8, { name: 'okay', title: 'Третья' }),
      rd(9, { name: 'mute', title: 'Четвёртая' }),
    ]);
    expect(a.get(1)?.titleError).toBeTruthy();
    expect(a.get(2)?.secondsError).toBeTruthy();
    expect(a.get(3)?.secondsError).toBeTruthy();
    expect(a.get(4)?.secondsError).toBeUndefined();
    expect(a.get(5)?.secondsError).toBeTruthy();
    expect(a.get(6)?.nameError).toContain('занято');
    expect(a.get(7)?.nameError).toContain('занято');
    expect(a.get(8)?.nameError).toBeUndefined();
    expect(a.get(9)?.nameError).toContain('зарезервировано'); // "mute" is a command word
  });

  test('the same title twice in a channel is a duplicate (case-insensitive); another channel is fine', async () => {
    const a = await analyseRedeems(host, [rd(1, { title: 'Мут Чудили' }), rd(2, { title: 'мут чудили' }), rd(3, { title: 'мут чудили', channel: 'other' })]);
    expect(a.get(2)?.duplicateOf).toBe(1);
    expect(a.get(1)?.duplicateOf).toBeUndefined();
    expect(a.get(3)?.duplicateOf).toBeUndefined();
  });

  test('a title that contains an earlier enabled title is caught by the earlier redeem', async () => {
    const a = await analyseRedeems(host, [rd(1, { title: 'Мут' }), rd(2, { title: 'Мут чудили 2' }), rd(3, { title: 'Анмут', action: 'untimeout' }), rd(4, { title: 'Мут', enabled: false }), rd(5, { title: 'Другой мут', channel: 'other' })]);
    expect(a.get(2)?.shadowedBy).toBe(1);
    expect(a.get(3)?.shadowedBy).toBe(1); // "анмут" contains "мут": the first match wins in the plugin too
    expect(a.get(1)?.shadowedBy).toBeUndefined();
    expect(a.get(5)?.shadowedBy).toBeUndefined();
  });

  test('a disabled earlier redeem catches nothing', async () => {
    const a = await analyseRedeems(host, [rd(1, { title: 'Мут', enabled: false }), rd(2, { title: 'Мут чудили' })]);
    expect(a.get(2)?.shadowedBy).toBeUndefined();
  });
});

describe('previewAll: timers first, then rules', () => {
  const running = (id: number, more: Partial<Timer> = {}) => t(id, { enabled: true, started_at: 1_800_000_000, ...more });
  const base = { text: '', channel: 'main', flags: [] as string[], me: 'streamer', elapsedSeconds: 9300 };
  const rules = [r(1, 'правило', [word('!game')])];

  test('a running timer wins over a rule that also matches, and renders {time} in its format', async () => {
    const p = await previewAll(host, [running(1)], rules, { ...base, text: '!game' });
    expect(p.winner).toMatchObject({ kind: 'timer', id: 1, time: '2 ч 35 мин' });
    const full = await previewAll(host, [running(1, { format: 'full' })], rules, { ...base, text: '!game' });
    expect(full.winner).toMatchObject({ time: '2:35:00' });
  });

  test('a timer that is not running, or on another channel, or broken, does not answer; the rule does', async () => {
    for (const timer of [t(1), running(1, { channel: 'other' }), running(1, { reply: 'без времени' })]) {
      const p = await previewAll(host, [timer], rules, { ...base, text: '!game' });
      expect(p.winner).toMatchObject({ kind: 'rule', id: 1 });
      expect(p.timers[0]?.matched).toBe(true); // the rows still say what matched, so the page can explain
    }
    expect((await previewAll(host, [t(1)], rules, { ...base, text: '!game' })).timers[0]).toMatchObject({ running: false, active: true });
  });

  test('the first running matching timer wins; nobody wins when nothing matches', async () => {
    const p = await previewAll(host, [running(1, { conditions: [word('x')] }), running(2)], [], { ...base, text: '!game' });
    expect(p.winner).toMatchObject({ kind: 'timer', id: 2 });
    expect((await previewAll(host, [running(1)], rules, { ...base, text: 'привет' })).winner).toBeNull();
  });

  test('the elapsed time under a minute reads "только начал"', async () => {
    const p = await previewAll(host, [running(1)], [], { ...base, text: '!game', elapsedSeconds: 10 });
    expect(p.winner).toMatchObject({ time: 'только начал' });
  });
});

describe('helpers over the plugin\'s util', () => {
  test('parseDuration is the plugin\'s own', async () => {
    expect(await parseDuration(host, '10m')).toBe(600);
    expect(await parseDuration(host, '1h30m')).toBe(5400);
    expect(await parseDuration(host, '2D')).toBe(172800);
    expect(await parseDuration(host, '1h 30m')).toBeNull();
    expect(await parseDuration(host, 'abc')).toBeNull();
    expect(await parseDuration(host, '')).toBeNull();
  });
  test('durationText always reads back to the same number', async () => {
    for (const n of [1, 59, 60, 61, 600, 3599, 3600, 5400, 86399, 86400, 90061, 1_209_600]) expect(await parseDuration(host, durationText(n))).toBe(n);
  });
  test('elapsedExample is util.format_elapsed', async () => {
    expect(await elapsedExample(host, 'smart', 0)).toBe('только начал');
    expect(await elapsedExample(host, 'smart', 2100)).toBe('35 мин');
    expect(await elapsedExample(host, 'smart', 9300)).toBe('2 ч 35 мин');
    expect(await elapsedExample(host, 'full', 9300)).toBe('2:35:00');
  });
});

// The {time} requirement lives inside E.add_timer; uichecks keeps a one-line copy. This fails if the plugin changes it.
const engine = resolve(process.env.PLUGIN_REPO ?? '../auto-reply-plugin', 'auto-reply/engine.lua');
describe.skipIf(!existsSync(engine))('timer reply copy (PLUGIN_REPO)', () => {
  test('E.add_timer still requires {time} with the same message', () => {
    const src = readFileSync(engine, 'utf8');
    expect(src).toContain('if not reply:find("{time}", 1, true) then');
    expect(src).toContain('в ответе должен быть {time}');
  });
});
