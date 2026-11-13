import { deepEqual, type Config } from './config.ts';
import { fixCounters } from './ids.ts';

export interface MergeNote {
  path: string;
  note: string;
}
export interface Conflict {
  path: string;
  base: unknown;
  theirs: unknown;
  mine: unknown;
}
export type MergeResult = { ok: true; config: Config; notes: MergeNote[] } | { ok: false; conflicts: Conflict[]; theirs: Config };

/** Fields the plugin owns while it runs; the UI only changes them through an explicit action (enable timer). */
const LIVE_TOP = new Set(['active_until']);
const LIVE_TIMER = new Set(['enabled', 'started_at', 'game_id']);
const STRING_LISTS = new Set(['channels', 'ignore_users', 'protect_users']);
const ITEM_LISTS = new Set(['rules', 'timers', 'redeems']);
const COUNTERS = new Set(['next_rule_id', 'next_timer_id', 'next_redeem_id']);

type Item = { id: number; [key: string]: unknown };
interface Ctx {
  notes: MergeNote[];
  conflicts: Conflict[];
}

/**
 * Three-way merge of one value. base = what the UI loaded, theirs = what is on disk now, mine = the UI's edit.
 * `live` fields prefer the plugin: the UI's copy is only used when the user changed it on purpose.
 */
function three(path: string, b: unknown, t: unknown, m: unknown, ctx: Ctx, live = false): unknown {
  if (deepEqual(m, b)) {
    if (live && !deepEqual(t, b)) ctx.notes.push({ path, note: 'live value taken from disk (the UI copy was stale)' });
    return t;
  }
  if (deepEqual(t, b) || deepEqual(t, m)) return m;
  if (live) {
    ctx.notes.push({ path, note: "live value kept from the plugin; the UI change was dropped" });
    return t;
  }
  ctx.conflicts.push({ path, base: b, theirs: t, mine: m });
  return t;
}

function mergeObject(path: string, b: Record<string, unknown>, t: Record<string, unknown>, m: Record<string, unknown>, ctx: Ctx, live: Set<string>) {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)]);
  for (const key of keys) {
    const v = three(`${path}${path ? '.' : ''}${key}`, b[key], t[key], m[key], ctx, live.has(key));
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function mergeStringList(b: string[], t: string[], m: string[]): string[] {
  const removed = new Set(b.filter((x) => !m.includes(x)));
  const added = m.filter((x) => !b.includes(x));
  const out = t.filter((x) => !removed.has(x));
  for (const x of added) if (!out.includes(x)) out.push(x);
  return out;
}

const idsOf = (items: Item[]) => items.map((i) => i.id);
const sameSeq = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function mergeItems(list: string, b: Item[], t: Item[], m: Item[], ctx: Ctx): Item[] {
  const bm = new Map(b.map((i) => [i.id, i]));
  const tm = new Map(t.map((i) => [i.id, i]));
  const mm = new Map(m.map((i) => [i.id, i]));
  const live = list === 'timers' ? LIVE_TIMER : new Set<string>();
  const result = new Map<number, Item>();
  const extra: Item[] = []; // my items renumbered after an id collision
  const allIds = new Set([...bm.keys(), ...tm.keys(), ...mm.keys()]);

  for (const id of allIds) {
    const bi = bm.get(id), ti = tm.get(id), mi = mm.get(id);
    const path = `${list}[${id}]`;
    if (bi && ti && mi) {
      result.set(id, mergeObject(path, bi, ti, mi, ctx, live) as Item);
    } else if (!bi && ti && mi) {
      if (deepEqual(ti, mi)) result.set(id, ti);
      else {
        result.set(id, ti);
        extra.push(mi); // both sides created an item with this id: keep both, mine gets a fresh id below
      }
    } else if (!bi && ti) result.set(id, ti);
    else if (!bi && mi) result.set(id, mi);
    else if (bi && ti && !mi) {
      if (deepEqual(ti, bi)) continue; // I deleted it, the plugin left it alone
      ctx.conflicts.push({ path, base: bi, theirs: ti, mine: undefined });
      result.set(id, ti);
    } else if (bi && mi && !ti) {
      if (deepEqual(mi, bi)) continue; // the plugin (or a hand edit) deleted it, I left it alone
      ctx.conflicts.push({ path, base: bi, theirs: undefined, mine: mi });
      result.set(id, mi);
    }
  }

  // Order: follow the plugin's, unless only I reordered; then follow mine. Both reordered differently: conflict.
  const common = (ids: number[]) => ids.filter((id) => result.has(id) && bm.has(id));
  const baseSeq = common(idsOf(b));
  const tSeq = common(idsOf(t));
  const mSeq = common(idsOf(m));
  let primary: number[];
  if (sameSeq(mSeq, baseSeq) || sameSeq(mSeq, tSeq)) primary = idsOf(t);
  else if (sameSeq(tSeq, baseSeq)) primary = idsOf(m);
  else {
    ctx.conflicts.push({ path: `${list}.order`, base: idsOf(b), theirs: idsOf(t), mine: idsOf(m) });
    primary = idsOf(t);
  }
  const ordered: number[] = [];
  for (const id of [...primary, ...idsOf(m), ...idsOf(t)]) if (result.has(id) && !ordered.includes(id)) ordered.push(id);
  const out = ordered.map((id) => result.get(id)!);

  let next = Math.max(0, ...allIds, ...out.map((i) => i.id));
  for (const item of extra) {
    next += 1;
    ctx.notes.push({ path: `${list}[${item.id}]`, note: `renumbered to ${next} (the plugin created an item with the same id)` });
    out.push({ ...item, id: next });
  }
  return out;
}

export function mergeConfigs(base: Config, theirs: Config, mine: Config): MergeResult {
  const ctx: Ctx = { notes: [], conflicts: [] };
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)]);
  for (const key of keys) {
    const b = base[key], t = theirs[key], m = mine[key];
    let v: unknown;
    if (ITEM_LISTS.has(key)) v = mergeItems(key, b as Item[], t as Item[], m as Item[], ctx);
    else if (STRING_LISTS.has(key)) v = mergeStringList(b as string[], t as string[], m as string[]);
    else if (COUNTERS.has(key)) v = Math.max(Number(t) || 0, Number(m) || 0);
    else v = three(key, b, t, m, ctx, LIVE_TOP.has(key));
    if (v !== undefined) out[key] = v;
  }
  const config = out as Config;
  fixCounters(config);
  return ctx.conflicts.length ? { ok: false, conflicts: ctx.conflicts, theirs } : { ok: true, config, notes: ctx.notes };
}
