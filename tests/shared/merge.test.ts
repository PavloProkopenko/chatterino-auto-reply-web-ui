import { describe, expect, test } from 'vitest';
import { normalise, type Config } from '../../src/shared/config.ts';
import { mergeConfigs } from '../../src/shared/merge.ts';

const rule = (id: number, reply = 'r') => ({ id, enabled: true, reply, channels: [], conditions: [{ type: 'word', match: 'x' }] });
const timer = (id: number, extra: Record<string, unknown> = {}) => ({
  id, channel: 'a', reply: 'идёт {time}', format: 'smart', on_category: 'reset',
  conditions: [{ type: 'word', match: 'старт' }], enabled: false, ...extra,
});
const start = (extra: Record<string, unknown> = {}): Config =>
  normalise({
    active_until: 'forever', channels: ['a'], ignore_users: ['u1'], next_rule_id: 4,
    rules: [rule(1), rule(2), rule(3)], next_timer_id: 2, timers: [timer(1)], ...extra,
  });
const copy = (c: Config, fn: (c: Config) => void): Config => {
  const x = structuredClone(c);
  fn(x);
  return x;
};
const merged = (b: Config, t: Config, m: Config) => {
  const r = mergeConfigs(b, t, m);
  if (!r.ok) throw new Error('unexpected conflicts: ' + JSON.stringify(r.conflicts));
  return r;
};

describe('unprotect_users (plugin 0.9.0) merges per user like the other lists', () => {
  test('additions on both sides are kept, a removal on one side wins over no change', () => {
    const b = start({ protect_users: ['mod1'], unprotect_users: ['vip1', 'vip2'] });
    const mine = copy(b, (c) => (c.unprotect_users = ['vip1', 'vip2', 'vip3']));
    const theirs = copy(b, (c) => (c.unprotect_users = ['vip2', 'vip4'])); // the plugin: vip1 removed, vip4 added
    expect(merged(b, theirs, mine).config.unprotect_users.sort()).toEqual(['vip2', 'vip3', 'vip4']);
  });
  test('a file without the key reads as an empty list', () => {
    expect(normalise({}).unprotect_users).toEqual([]);
    expect(normalise({ unprotect_users: {} }).unprotect_users).toEqual([]);
  });
});

describe('mergeConfigs', () => {
  test('no edits on either side gives the disk version', () => {
    const b = start();
    const t = copy(b, (c) => (c.rules[0]!.reply = 'новый'));
    expect(merged(b, t, b).config).toEqual(t);
  });

  test("UI edit and the plugin's live-state change both survive", () => {
    const b = start();
    const t = copy(b, (c) => Object.assign(c.timers[0]!, { enabled: true, started_at: 1700000000, game_id: '9' }));
    const m = copy(b, (c) => (c.rules[0]!.reply = 'моё'));
    const r = merged(b, t, m);
    expect(r.config.rules[0]!.reply).toBe('моё');
    expect(r.config.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000, game_id: '9' });
  });

  test('stale live state is never written: the master switch comes from disk', () => {
    const b = start({ active_until: 'forever' });
    const t = copy(b, (c) => delete c.active_until); // plugin turned it off
    const m = copy(b, (c) => (c.per_user_cooldown = 5));
    const r = merged(b, t, m);
    expect('active_until' in r.config).toBe(false);
    expect(r.config.per_user_cooldown).toBe(5);
    expect(r.notes.some((n) => n.path === 'active_until')).toBe(true);
  });

  test('an explicit "enable timer" in the UI is kept when the plugin did not touch the timer', () => {
    const b = start();
    const m = copy(b, (c) => Object.assign(c.timers[0]!, { enabled: true, started_at: 1800000000 }));
    expect(merged(b, b, m).config.timers[0]).toMatchObject({ enabled: true, started_at: 1800000000 });
  });

  test('both sides edit the same field differently: conflict with path and all three values', () => {
    const b = start();
    const t = copy(b, (c) => (c.rules[1]!.reply = 'плагин'));
    const m = copy(b, (c) => (c.rules[1]!.reply = 'я'));
    const r = mergeConfigs(b, t, m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts).toEqual([{ path: 'rules[2].reply', base: 'r', theirs: 'плагин', mine: 'я' }]);
  });

  test('different fields of the same rule merge', () => {
    const b = start();
    const t = copy(b, (c) => (c.rules[1]!.enabled = false));
    const m = copy(b, (c) => (c.rules[1]!.reply = 'я'));
    expect(merged(b, t, m).config.rules[1]).toMatchObject({ enabled: false, reply: 'я' });
  });

  test('plugin deleted an item I did not touch: it is gone; if I edited it, that is a conflict', () => {
    const b = start();
    const t = copy(b, (c) => (c.rules = c.rules.filter((r) => r.id !== 2)));
    expect(merged(b, t, b).config.rules.map((r) => r.id)).toEqual([1, 3]);
    const m = copy(b, (c) => (c.rules[1]!.reply = 'правка'));
    const r = mergeConfigs(b, t, m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts[0]!.path).toBe('rules[2]');
  });

  test('I deleted an item the plugin did not touch: it is gone', () => {
    const b = start();
    const m = copy(b, (c) => (c.rules = c.rules.filter((r) => r.id !== 1)));
    expect(merged(b, b, m).config.rules.map((r) => r.id)).toEqual([2, 3]);
  });

  test('both sides added an item with the same id: mine is renumbered, counters stay ahead of every id', () => {
    const b = start();
    const t = copy(b, (c) => {
      c.rules.push(rule(4, 'от плагина'));
      c.next_rule_id = 5;
    });
    const m = copy(b, (c) => {
      c.rules.push(rule(4, 'от UI'));
      c.next_rule_id = 5;
    });
    const r = merged(b, t, m);
    expect(r.config.rules.map((x) => [x.id, x.reply])).toEqual([[1, 'r'], [2, 'r'], [3, 'r'], [4, 'от плагина'], [5, 'от UI']]);
    expect(r.config.next_rule_id).toBe(6);
    expect(r.notes.some((n) => n.note.includes('renumbered'))).toBe(true);
  });

  test('string lists merge as sets: additions from both sides, my removals applied', () => {
    const b = start();
    const t = copy(b, (c) => c.ignore_users.push('plugin_user'));
    const m = copy(b, (c) => {
      c.ignore_users = ['u1'].filter((u) => u !== 'u1');
      c.ignore_users.push('ui_user');
    });
    expect(merged(b, t, m).config.ignore_users).toEqual(['plugin_user', 'ui_user']);
  });

  test("order: follow the plugin's order unless I reordered; follow mine if only I did", () => {
    const b = start();
    const reorderedByPlugin = copy(b, (c) => c.rules.reverse());
    expect(merged(b, reorderedByPlugin, b).config.rules.map((r) => r.id)).toEqual([3, 2, 1]);
    const reorderedByMe = copy(b, (c) => c.rules.reverse());
    expect(merged(b, b, reorderedByMe).config.rules.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  test('both reordered differently: order conflict', () => {
    const b = start();
    const t = copy(b, (c) => c.rules.reverse());
    const m = copy(b, (c) => c.rules.push(c.rules.shift()!));
    const r = mergeConfigs(b, t, m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts[0]!.path).toBe('rules.order');
  });

  test('counters never go below the plugin\'s or mine', () => {
    const b = start();
    const t = copy(b, (c) => (c.next_timer_id = 10));
    const m = copy(b, (c) => (c.next_rule_id = 20));
    const r = merged(b, t, m);
    expect([r.config.next_timer_id, r.config.next_rule_id]).toEqual([10, 20]);
  });
});

describe('mergeConfigs with resolutions (the user picked a side per conflict)', () => {
  const b = start();

  test('same field: mine or theirs, everything else still merged', () => {
    const t = copy(b, (c) => {
      c.rules[1]!.reply = 'плагин';
      Object.assign(c.timers[0]!, { enabled: true, started_at: 1700000000 });
    });
    const m = copy(b, (c) => (c.rules[1]!.reply = 'я'));
    const mine = mergeConfigs(b, t, m, { 'rules[2].reply': 'mine' });
    const theirs = mergeConfigs(b, t, m, { 'rules[2].reply': 'theirs' });
    expect(mine.ok && mine.config.rules[1]!.reply).toBe('я');
    expect(theirs.ok && theirs.config.rules[1]!.reply).toBe('плагин');
    // the plugin's live state survives either way: no stale value is written back
    for (const r of [mine, theirs]) expect(r.ok && r.config.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 });
  });

  test('delete vs edit: keep the item or let it go', () => {
    const t = copy(b, (c) => (c.rules = c.rules.filter((r) => r.id !== 2)));
    const m = copy(b, (c) => (c.rules[1]!.reply = 'правка'));
    const keep = mergeConfigs(b, t, m, { 'rules[2]': 'mine' });
    const drop = mergeConfigs(b, t, m, { 'rules[2]': 'theirs' });
    expect(keep.ok && keep.config.rules.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(drop.ok && drop.config.rules.map((r) => r.id)).toEqual([1, 3]);
  });

  test('order conflict: either order can be chosen', () => {
    const t = copy(b, (c) => c.rules.reverse());
    const m = copy(b, (c) => c.rules.push(c.rules.shift()!));
    const mine = mergeConfigs(b, t, m, { 'rules.order': 'mine' });
    const theirs = mergeConfigs(b, t, m, { 'rules.order': 'theirs' });
    expect(mine.ok && mine.config.rules.map((r) => r.id)).toEqual([2, 3, 1]);
    expect(theirs.ok && theirs.config.rules.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  test('an unresolved conflict is still reported', () => {
    const t = copy(b, (c) => (c.rules[1]!.reply = 'плагин'));
    const m = copy(b, (c) => (c.rules[1]!.reply = 'я'));
    expect(mergeConfigs(b, t, m, { 'something.else': 'mine' }).ok).toBe(false);
  });
});
