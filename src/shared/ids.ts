import type { Config, Redeem, Rule, Timer } from './config.ts';

type ListName = 'rules' | 'timers' | 'redeems';
const COUNTER: Record<ListName, 'next_rule_id' | 'next_timer_id' | 'next_redeem_id'> = {
  rules: 'next_rule_id',
  timers: 'next_timer_id',
  redeems: 'next_redeem_id',
};

/** Raise each next_*_id to at least max(id)+1. Counters only ever go up: ids are never reused. */
export function fixCounters(cfg: Config): void {
  for (const list of Object.keys(COUNTER) as ListName[]) {
    const ids = (cfg[list] as { id: unknown }[]).map((i) => i.id).filter((n): n is number => typeof n === 'number');
    const floor = ids.length ? Math.max(...ids) + 1 : 1;
    const key = COUNTER[list];
    if (typeof cfg[key] !== 'number' || cfg[key] < floor) cfg[key] = floor;
  }
}

function add<T extends { id: number }>(cfg: Config, list: ListName, draft: Omit<T, 'id'>): T {
  fixCounters(cfg);
  const key = COUNTER[list];
  const item = { id: cfg[key], ...draft } as T;
  (cfg[list] as unknown as T[]).push(item);
  cfg[key] += 1;
  return item;
}

export const addRule = (cfg: Config, draft: Omit<Rule, 'id'>): Rule => add<Rule>(cfg, 'rules', draft);
export const addTimer = (cfg: Config, draft: Omit<Timer, 'id'>): Timer => add<Timer>(cfg, 'timers', draft);
export const addRedeem = (cfg: Config, draft: Omit<Redeem, 'id'>): Redeem => add<Redeem>(cfg, 'redeems', draft);

/** Removes an item. The counter is left alone, so its id is never handed out again. */
export function removeItem(cfg: Config, list: ListName, id: number): boolean {
  const items = cfg[list] as { id: number }[];
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}

/** Moves an item inside its list (list order is rule priority). Out-of-range targets clamp. */
export function moveItem<T>(items: T[], from: number, to: number): void {
  if (from < 0 || from >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(to, items.length)), 0, item as T);
}
