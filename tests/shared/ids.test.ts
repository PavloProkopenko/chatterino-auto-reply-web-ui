import { describe, expect, test } from 'vitest';
import { normalise, type Config } from '../../src/shared/config.ts';
import { addRule, addTimer, addRedeem, fixCounters, moveItem, removeItem } from '../../src/shared/ids.ts';

const rule = (id: number) => ({ id, enabled: true, reply: 'r', channels: [], conditions: [{ type: 'word', match: 'x' }] });
const base = (over: Record<string, unknown> = {}): Config => normalise({ next_rule_id: 4, rules: [rule(1), rule(3)], ...over });

describe('ids', () => {
  test('a new rule takes next_rule_id and advances the counter', () => {
    const c = base();
    const created = addRule(c, { enabled: true, reply: 'n', channels: [], conditions: [{ type: 'word', match: 'y' }] });
    expect(created.id).toBe(4);
    expect(c.next_rule_id).toBe(5);
    expect(c.rules.map((r) => r.id)).toEqual([1, 3, 4]);
  });

  test('ids are never reused after a delete, even of the newest item', () => {
    const c = base();
    const a = addRule(c, { enabled: true, reply: 'n', channels: [], conditions: [] });
    removeItem(c, 'rules', a.id);
    expect(c.next_rule_id).toBe(5);
    expect(addRule(c, { enabled: true, reply: 'm', channels: [], conditions: [] }).id).toBe(5);
  });

  test('a counter that is behind the highest id (hand-edited file) is repaired upwards, never down', () => {
    const c = base({ next_rule_id: 2 });
    fixCounters(c);
    expect(c.next_rule_id).toBe(4);
    const d = base({ next_rule_id: 99 });
    fixCounters(d);
    expect(d.next_rule_id).toBe(99);
  });

  test('adding repairs a stale counter first so an existing id is never handed out', () => {
    const c = base({ next_rule_id: 1 });
    expect(addRule(c, { enabled: true, reply: 'n', channels: [], conditions: [] }).id).toBe(4);
  });

  test('timers and redeems have their own counters', () => {
    const c = normalise({});
    const t = addTimer(c, { channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [], enabled: false });
    const r = addRedeem(c, { channel: 'a', title: 't', action: 'untimeout', enabled: true });
    expect([t.id, r.id, c.next_timer_id, c.next_redeem_id]).toEqual([1, 1, 2, 2]);
    expect(c.next_rule_id).toBe(1);
  });

  test('reordering keeps ids and moves the priority', () => {
    const c = base();
    moveItem(c.rules, 1, 0);
    expect(c.rules.map((r) => r.id)).toEqual([3, 1]);
    moveItem(c.rules, 0, 5); // out of range clamps to the end
    expect(c.rules.map((r) => r.id)).toEqual([1, 3]);
    expect(c.next_rule_id).toBe(4);
  });

  test('removing an unknown id is a no-op that reports false', () => {
    const c = base();
    expect(removeItem(c, 'rules', 42)).toBe(false);
    expect(c.rules).toHaveLength(2);
  });
});
