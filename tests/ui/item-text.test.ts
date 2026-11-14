import { describe, expect, test } from 'vitest';
import type { Redeem, Timer } from '../../src/shared/config.ts';
import { featuresFor } from '../../src/shared/features.ts';
import { channelMissing, describeRedeem, droppedLiveTimers, redeemGatingProblems, startedText, timerGatingProblems } from '../../src/ui/state/item-text.ts';

const timer = (more: Partial<Timer> = {}): Timer => ({ id: 1, channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: 'x' }], enabled: false, ...more });
const redeem = (more: Partial<Redeem> = {}): Redeem => ({ id: 1, channel: 'a', title: 'Мут', action: 'timeout', seconds: 600, enabled: true, ...more });

describe('channelMissing', () => {
  test('case does not matter; an empty channel counts as missing', () => {
    expect(channelMissing('A', ['a'])).toBe(false);
    expect(channelMissing('b', ['a'])).toBe(true);
    expect(channelMissing('', ['a'])).toBe(true);
  });
});

describe('describeRedeem', () => {
  test('timeout with its duration in words, unmute, and a missing duration', () => {
    expect(describeRedeem(redeem())).toBe('мут на 10 минут');
    expect(describeRedeem(redeem({ seconds: 5400 }))).toBe('мут на 1 час 30 минут');
    expect(describeRedeem(redeem({ action: 'untimeout', seconds: undefined }))).toBe('снять мут');
    expect(describeRedeem(redeem({ seconds: undefined }))).toBe('мут');
  });
});

describe('version gating', () => {
  test('timers: names need 0.2.1, skip options 0.5.0; an unknown version has its own wording', () => {
    const t = timer({ name: 'x', skip_mods: true });
    expect(timerGatingProblems(timer(), featuresFor(null))).toEqual([]);
    expect(timerGatingProblems(t, featuresFor('0.2.0'))).toHaveLength(2);
    expect(timerGatingProblems(t, featuresFor('0.5.0'))).toEqual([]);
    expect(timerGatingProblems(t, featuresFor(null))[0]).not.toBe(timerGatingProblems(t, featuresFor('0.1.0'))[0]);
  });
  test('redeems: names only', () => {
    expect(redeemGatingProblems(redeem(), featuresFor('0.1.0'))).toEqual([]);
    expect(redeemGatingProblems(redeem({ name: 'x' }), featuresFor('0.2.0'))).toHaveLength(1);
    expect(redeemGatingProblems(redeem({ name: 'x' }), featuresFor('0.2.1'))).toEqual([]);
  });
});

describe('droppedLiveTimers', () => {
  const note = (path: string, text = "live value kept from the plugin; the UI change was dropped") => ({ path, note: text });
  test('finds the timers whose start or stop the plugin overruled, once each', () => {
    const notes = [note('timers[2].enabled'), note('timers[2].started_at'), note('timers[5].started_at'), note('rules[1].reply'), note('timers[7].enabled', 'live value taken from disk (the UI copy was stale)')];
    expect(droppedLiveTimers(notes)).toEqual([2, 5]);
  });
  test('nothing dropped, nothing reported', () => {
    expect(droppedLiveTimers([])).toEqual([]);
  });
});

describe('startedText', () => {
  test('a readable local date and time', () => {
    const s = startedText(1_800_000_000);
    expect(s).toMatch(/\d{4}/);
    expect(s.length).toBeGreaterThan(8);
  });
});
