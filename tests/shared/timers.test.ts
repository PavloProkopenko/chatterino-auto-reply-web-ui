import { describe, expect, test } from 'vitest';
import { normalise } from '../../src/shared/config.ts';
import { enableTimerNow } from '../../src/shared/timers.ts';

const cfg = () =>
  normalise({
    timers: [{ id: 1, channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [], enabled: false, game_id: 'old' }],
  });

describe('enableTimerNow', () => {
  test('starts counting from now, like the plugin, without a game id', () => {
    const c = cfg();
    expect(enableTimerNow(c, 1, 1800000000)).toEqual({ ok: true });
    expect(c.timers[0]).toMatchObject({ enabled: true, started_at: 1800000000 });
    expect('game_id' in c.timers[0]!).toBe(false);
  });
  test('unknown timer id', () => {
    expect(enableTimerNow(cfg(), 9, 1)).toEqual({ ok: false, error: 'timer 9 not found' });
  });
});
