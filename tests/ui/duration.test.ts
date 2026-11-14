import { describe, expect, test } from 'vitest';
import { describeDuration, durationText, MAX_MUTE_SECONDS, QUICK_DURATIONS } from '../../src/ui/state/duration.ts';

describe('describeDuration', () => {
  test('Russian words with the right plural forms', () => {
    expect(describeDuration(1)).toBe('1 секунда');
    expect(describeDuration(2)).toBe('2 секунды');
    expect(describeDuration(5)).toBe('5 секунд');
    expect(describeDuration(11)).toBe('11 секунд');
    expect(describeDuration(21)).toBe('21 секунда');
    expect(describeDuration(600)).toBe('10 минут');
    expect(describeDuration(60)).toBe('1 минута');
    expect(describeDuration(3600)).toBe('1 час');
    expect(describeDuration(5400)).toBe('1 час 30 минут');
    expect(describeDuration(7200)).toBe('2 часа');
    expect(describeDuration(90)).toBe('1 минута 30 секунд');
    expect(describeDuration(86400)).toBe('1 день');
    expect(describeDuration(172800)).toBe('2 дня');
    expect(describeDuration(MAX_MUTE_SECONDS)).toBe('14 дней');
    expect(describeDuration(90061)).toBe('1 день 1 час 1 минута 1 секунда');
  });
});

describe('durationText', () => {
  test('the compact form the plugin parses', () => {
    expect(durationText(30)).toBe('30s');
    expect(durationText(600)).toBe('10m');
    expect(durationText(5400)).toBe('1h30m');
    expect(durationText(172800)).toBe('2d');
    expect(durationText(90061)).toBe('1d1h1m1s');
  });
  test('quick values are whole, valid mutes', () => {
    expect(QUICK_DURATIONS.map((q) => q.seconds)).toEqual([60, 600, 3600, 86400]);
    for (const q of QUICK_DURATIONS) expect(q.seconds).toBeLessThanOrEqual(MAX_MUTE_SECONDS);
  });
});
