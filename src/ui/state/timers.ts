import type { Condition, Config } from '../../shared/config.ts';
import { disableTimer, enableTimerNow } from '../../shared/timers.ts';
import { saveItem } from './lists.ts';

/** A timer's fields as the constructor edits them. Live state (`enabled`, `started_at`, `game_id`) is not among them. */
export interface TimerFields {
  name?: string;
  channel: string;
  reply: string;
  format: string;
  on_category: string;
  conditions: Condition[];
  skip_mods?: boolean;
  skip_users?: string[];
  [key: string]: unknown;
}
export type TimerDraft = TimerFields & { id?: number };

export const TIMER_FORMATS = ['smart', 'full'] as const;
export const TIMER_CATEGORY = ['reset', 'stop', 'off'] as const;

export function emptyTimer(channel = ''): TimerFields {
  return { channel, reply: '', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: '' }] };
}

const OPTIONAL = ['name', 'skip_mods', 'skip_users'];
const LIVE = ['enabled', 'started_at', 'game_id'];

/**
 * Adds a timer (created off, with no start time) or replaces one in place. An edit never touches the live state: the
 * plugin owns it, and the constructor's copy may be older than what the plugin has.
 */
export function saveTimer(cfg: Config, timer: TimerDraft): number {
  return saveItem(cfg, 'timers', timer, OPTIONAL, LIVE, { enabled: false });
}

/** "Запустить сейчас": counting starts at `nowSeconds`; the plugin fills in the category on its next check. */
export const startTimer = (cfg: Config, id: number, nowSeconds: number) => enableTimerNow(cfg, id, nowSeconds);
export const stopTimer = (cfg: Config, id: number) => disableTimer(cfg, id);

/** A timer the plugin counts right now, as far as the file says. */
export const isRunning = (t: { enabled?: unknown; started_at?: unknown }): boolean => t.enabled === true && typeof t.started_at === 'number';
