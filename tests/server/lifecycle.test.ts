import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLifecycle } from '../../src/server/lifecycle.ts';

let exits: number;
const make = () => createLifecycle({ onExit: () => exits++, firstTabMs: 60_000, byeGraceMs: 10_000, silenceMs: 180_000 });
beforeEach(() => {
  vi.useFakeTimers();
  exits = 0;
});
afterEach(() => vi.useRealTimers());

describe('lifecycle: when the app exits on its own', () => {
  test('exits if no tab ever connects within the first minute', () => {
    const l = make();
    l.start();
    vi.advanceTimersByTime(59_000);
    expect(exits).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(exits).toBe(1);
  });

  test('stays up while a tab keeps sending heartbeats', () => {
    const l = make();
    l.start();
    for (let i = 0; i < 40; i++) {
      l.heartbeat('tab-a');
      vi.advanceTimersByTime(10_000);
    }
    expect(exits).toBe(0);
  });

  test('exits ten seconds after the last tab says bye', () => {
    const l = make();
    l.start();
    l.heartbeat('tab-a');
    l.bye('tab-a');
    vi.advanceTimersByTime(9_000);
    expect(exits).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(exits).toBe(1);
  });

  test('a page reload (bye, then a new tab id right away) does not exit', () => {
    const l = make();
    l.start();
    l.heartbeat('tab-a');
    l.bye('tab-a');
    vi.advanceTimersByTime(2_000);
    l.heartbeat('tab-b');
    vi.advanceTimersByTime(120_000);
    l.heartbeat('tab-b');
    expect(exits).toBe(0);
  });

  test('closing one of two tabs keeps the app running, even if the other tab is throttled in the background', () => {
    const l = make();
    l.start();
    l.heartbeat('tab-a');
    l.heartbeat('tab-b');
    l.bye('tab-a');
    vi.advanceTimersByTime(60_000); // tab-b silent for a minute (background throttling) but not for three
    expect(exits).toBe(0);
  });

  test('a tab that disappears without saying bye (crash) expires after three minutes of silence', () => {
    const l = make();
    l.start();
    l.heartbeat('tab-a');
    vi.advanceTimersByTime(170_000);
    expect(exits).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(exits).toBe(1);
  });

  test('exits only once and stops its timers', () => {
    const l = make();
    l.start();
    vi.advanceTimersByTime(61_000);
    vi.advanceTimersByTime(600_000);
    expect(exits).toBe(1);
  });

  test('stop() cancels everything', () => {
    const l = make();
    l.start();
    l.stop();
    vi.advanceTimersByTime(600_000);
    expect(exits).toBe(0);
  });
});
