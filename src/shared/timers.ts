import type { Config } from './config.ts';

/**
 * The UI's one allowed change to timer live state: start counting now, like the plugin's own `start_counting`
 * but without a game id (the UI cannot know it). The caller shows the warning that elapsed time starts from zero.
 */
export function enableTimerNow(cfg: Config, id: number, nowSeconds: number): { ok: true } | { ok: false; error: string } {
  const timer = cfg.timers.find((t) => t.id === id);
  if (!timer) return { ok: false, error: `timer ${id} not found` };
  timer.enabled = true;
  timer.started_at = nowSeconds;
  delete timer.game_id;
  return { ok: true };
}

/** The UI's other allowed change to live state: stop, like the plugin's `set_timer_enabled(t, false)`. */
export function disableTimer(cfg: Config, id: number): { ok: true } | { ok: false; error: string } {
  const timer = cfg.timers.find((t) => t.id === id);
  if (!timer) return { ok: false, error: `timer ${id} not found` };
  timer.enabled = false;
  delete timer.started_at;
  delete timer.game_id;
  return { ok: true };
}
