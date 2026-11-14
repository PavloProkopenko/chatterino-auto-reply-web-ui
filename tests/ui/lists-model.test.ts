import { describe, expect, test } from 'vitest';
import { normalise, type Config, type Redeem, type Timer } from '../../src/shared/config.ts';
import { mergeConfigs } from '../../src/shared/merge.ts';
import { deleteItems, moveStep, moveTo } from '../../src/ui/state/lists.ts';
import { emptyRedeem, saveRedeem, setRedeemEnabled } from '../../src/ui/state/redeems.ts';
import { emptyTimer, saveTimer } from '../../src/ui/state/timers.ts';

const timer = (id: number, more: Partial<Timer> = {}): Timer => ({ id, channel: 'a', reply: `{time} ${id}`, format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: `t${id}` }], enabled: false, ...more });
const redeem = (id: number, more: Partial<Redeem> = {}): Redeem => ({ id, channel: 'a', title: `награда ${id}`, action: 'timeout', seconds: 600, enabled: true, ...more });
const cfg = (timers: Timer[] = [], redeems: Redeem[] = []): Config =>
  normalise({ channels: ['a'], timers, redeems, next_timer_id: timers.length + 1, next_redeem_id: redeems.length + 1 });
const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

describe('generic list helpers', () => {
  test('delete leaves the counter alone', () => {
    const c = cfg([timer(1), timer(2), timer(3)]);
    expect(deleteItems(c, 'timers', [2, 99])).toBe(1);
    expect(ids(c.timers)).toEqual([1, 3]);
    expect(c.next_timer_id).toBe(4);
  });
  test('step and drag move within the list, clamped; unknown ids change nothing', () => {
    const c = cfg([], [redeem(1), redeem(2), redeem(3), redeem(4)]);
    moveStep(c, 'redeems', 3, -1);
    expect(ids(c.redeems)).toEqual([1, 3, 2, 4]);
    moveStep(c, 'redeems', 1, -1);
    moveStep(c, 'redeems', 4, 1);
    expect(ids(c.redeems)).toEqual([1, 3, 2, 4]);
    moveTo(c, 'redeems', 1, 2);
    expect(ids(c.redeems)).toEqual([3, 2, 1, 4]);
    moveTo(c, 'redeems', 4, 3);
    expect(ids(c.redeems)).toEqual([4, 3, 2, 1]);
    moveTo(c, 'redeems', 9, 1);
    moveTo(c, 'redeems', 1, 9);
    expect(ids(c.redeems)).toEqual([4, 3, 2, 1]);
  });
});

describe('saveTimer', () => {
  test('a new timer is created off, with no start time, and takes the next id', () => {
    const c = cfg([timer(1)]);
    const id = saveTimer(c, { ...emptyTimer(), channel: 'a', reply: 'идёт {time}', conditions: [{ type: 'word', match: '!game' }] });
    expect(id).toBe(2);
    expect(c.next_timer_id).toBe(3);
    expect(c.timers[1]).toMatchObject({ id: 2, enabled: false });
    expect('started_at' in c.timers[1]!).toBe(false);
  });

  test('ids are never reused after a delete', () => {
    const c = cfg([timer(1), timer(2)]);
    deleteItems(c, 'timers', [2]);
    expect(saveTimer(c, emptyTimer())).toBe(3);
  });

  test('editing keeps the live state, whatever the draft carries, and unknown keys', () => {
    const c = cfg([timer(1, { enabled: true, started_at: 1800000000, game_id: 'g1', future: 7 })]);
    saveTimer(c, { ...timer(1), reply: 'новый {time}', enabled: false, started_at: 5, game_id: 'stale' });
    expect(c.timers[0]).toMatchObject({ id: 1, reply: 'новый {time}', enabled: true, started_at: 1800000000, game_id: 'g1', future: 7 });
  });

  test('an optional key the edit drops is removed', () => {
    const c = cfg([timer(1, { name: 'game', skip_users: ['bot'] })]);
    const draft: Record<string, unknown> = { ...timer(1) };
    delete draft.name;
    saveTimer(c, draft as never);
    expect(c.timers[0]).not.toHaveProperty('name');
    expect(c.timers[0]).not.toHaveProperty('skip_users');
  });

  test('the plugin changed started_at while the user edited the reply: the plugin keeps its value on save', () => {
    const base = cfg([timer(1, { enabled: true, started_at: 100, game_id: 'g' })]);
    const mine = structuredClone(base);
    saveTimer(mine, { ...timer(1), reply: 'мой {time}' });
    const theirs = structuredClone(base);
    theirs.timers[0]!.started_at = 999; // the plugin restarted the timer after a category change
    theirs.timers[0]!.game_id = 'g2';
    const merged = mergeConfigs(base, theirs, mine);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.config.timers[0]).toMatchObject({ reply: 'мой {time}', started_at: 999, game_id: 'g2', enabled: true });
  });
});

describe('saveRedeem', () => {
  test('a new redeem takes the next id; ids are never reused', () => {
    const c = cfg([], [redeem(1), redeem(2)]);
    deleteItems(c, 'redeems', [2]);
    expect(saveRedeem(c, { ...emptyRedeem(), title: 'Мут', seconds: 60 })).toBe(3);
  });
  test('editing keeps position, id and unknown keys; an unmute drops the duration', () => {
    const c = cfg([], [redeem(1, { future: 1 }), redeem(2)]);
    saveRedeem(c, { ...redeem(1), action: 'untimeout' });
    expect(ids(c.redeems)).toEqual([1, 2]);
    expect(c.redeems[0]).toMatchObject({ action: 'untimeout', future: 1 });
    expect(c.redeems[0]).not.toHaveProperty('seconds');
  });
  test('switching several on and off', () => {
    const c = cfg([], [redeem(1), redeem(2)]);
    setRedeemEnabled(c, 2, false);
    expect(c.redeems.map((r) => r.enabled)).toEqual([true, false]);
  });
});
