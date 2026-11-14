import type { Config } from '../../shared/config.ts';
import { addRedeem, addRule, addTimer, moveItem, removeItem } from '../../shared/ids.ts';

export type ListName = 'rules' | 'timers' | 'redeems';

/** Removes items; the counter stays, so their ids are never handed out again. Returns how many were removed. */
export function deleteItems(cfg: Config, list: ListName, ids: number[]): number {
  return ids.reduce((n, id) => n + (removeItem(cfg, list, id) ? 1 : 0), 0);
}

const idsOf = (cfg: Config, list: ListName) => cfg[list] as { id: number }[];

/** One step up (-1) or down (+1); list order is priority. Clamped at the ends. */
export function moveStep(cfg: Config, list: ListName, id: number, delta: -1 | 1): void {
  const items = idsOf(cfg, list);
  const from = items.findIndex((x) => x.id === id);
  if (from < 0) return;
  moveItem(items, from, Math.max(0, Math.min(from + delta, items.length - 1)));
}

/** Drag and drop: the item takes the place of the row it was dropped on. */
export function moveTo(cfg: Config, list: ListName, id: number, targetId: number): void {
  const items = idsOf(cfg, list);
  const from = items.findIndex((x) => x.id === id);
  const to = items.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  moveItem(items, from, to);
}

type Adder = (cfg: Config, draft: never) => { id: number };
const ADD: Record<ListName, Adder> = { rules: addRule as Adder, timers: addTimer as Adder, redeems: addRedeem as Adder };

/**
 * Adds an item (it takes the list's `next_*_id`) or, when `item.id` exists, replaces that item in place keeping the keys
 * the app does not know. Optional keys the edit no longer has are removed; `protectedKeys` always keep what is in the
 * config (live state the plugin owns). Returns the item's id.
 */
export function saveItem(cfg: Config, list: ListName, item: { id?: number } & Record<string, unknown>, optional: readonly string[], protectedKeys: readonly string[] = [], defaults: Record<string, unknown> = {}): number {
  const items = cfg[list] as ({ id: number } & Record<string, unknown>)[];
  const index = item.id === undefined ? -1 : items.findIndex((x) => x.id === item.id);
  if (index < 0) {
    const draft: Record<string, unknown> = { ...defaults, ...item };
    delete draft.id;
    return ADD[list](cfg, draft as never).id;
  }
  const draft: Record<string, unknown> = { ...item };
  for (const key of protectedKeys) delete draft[key];
  const next = { ...items[index]!, ...draft } as { id: number } & Record<string, unknown>;
  for (const key of optional) if (!(key in item)) delete next[key];
  items[index] = next;
  return next.id;
}
