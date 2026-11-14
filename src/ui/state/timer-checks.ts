import type { Redeem, Rule, Timer } from '../../shared/config.ts';
import type { LuaClient } from '../../lua/client.ts';
import type { PreviewInput, PreviewRow } from './rule-checks.ts';

type Lua = Pick<LuaClient, 'call'>;

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []); // an empty Lua table comes back as {}

export interface TimerAnalysis {
  id: number;
  replyError?: string;
  conditionError?: string;
  nameError?: string;
  shadowedBy?: number;
}

/** Reply ({time} required), condition and name problems per timer, found by the plugin's modules. */
export async function analyseTimers(lua: Lua, timers: Timer[], me: string): Promise<Map<number, TimerAnalysis>> {
  const [raw] = await lua.call('uichecks', 'analyse_timers', timers, me);
  const out = new Map<number, TimerAnalysis>();
  for (const r of list<Record<string, unknown>>(raw)) {
    const a: TimerAnalysis = { id: r.id as number };
    const reply = text(r.reply_error);
    const cond = text(r.condition_error);
    const name = text(r.name_error);
    if (reply) a.replyError = reply;
    if (cond) a.conditionError = cond;
    if (name) a.nameError = name;
    if (typeof r.shadowed_by === 'number') a.shadowedBy = r.shadowed_by;
    out.set(a.id, a);
  }
  return out;
}

export interface RedeemAnalysis {
  id: number;
  titleError?: string;
  secondsError?: string;
  nameError?: string;
  duplicateOf?: number;
  shadowedBy?: number;
}

export async function analyseRedeems(lua: Lua, redeems: Redeem[]): Promise<Map<number, RedeemAnalysis>> {
  const [raw] = await lua.call('uichecks', 'analyse_redeems', redeems);
  const out = new Map<number, RedeemAnalysis>();
  for (const r of list<Record<string, unknown>>(raw)) {
    const a: RedeemAnalysis = { id: r.id as number };
    const title = text(r.title_error);
    const seconds = text(r.seconds_error);
    const name = text(r.name_error);
    if (title) a.titleError = title;
    if (seconds) a.secondsError = seconds;
    if (name) a.nameError = name;
    if (typeof r.duplicate_of === 'number') a.duplicateOf = r.duplicate_of;
    if (typeof r.shadowed_by === 'number') a.shadowedBy = r.shadowed_by;
    out.set(a.id, a);
  }
  return out;
}

export interface TimerRow {
  id: number;
  running: boolean;
  active: boolean;
  applies: boolean;
  matched: boolean;
}
export interface PreviewAllInput extends PreviewInput {
  /** Stands in for the timers' real elapsed time (seconds). */
  elapsedSeconds: number;
}
export interface PreviewAllResult {
  winner: { kind: 'timer' | 'rule'; id: number; time?: string } | null;
  timers: TimerRow[];
  rules: PreviewRow[];
}

/** Running timers first, then rules, in the plugin's own Lua; the first match wins. */
export async function previewAll(lua: Lua, timers: Timer[], rules: Rule[], input: PreviewAllInput): Promise<PreviewAllResult> {
  const [raw] = await lua.call('uichecks', 'preview_all', timers, rules, input.text, input.flags, input.me, input.channel, input.elapsedSeconds);
  const r = (raw ?? {}) as { winner?: { kind?: unknown; id?: unknown; time?: unknown }; timers?: unknown; rules?: unknown };
  const w = r.winner;
  const kind = w?.kind === 'timer' ? 'timer' : w?.kind === 'rule' ? 'rule' : null;
  const winner: PreviewAllResult['winner'] = kind && typeof w?.id === 'number' ? { kind, id: w.id, ...(typeof w.time === 'string' ? { time: w.time } : {}) } : null;
  return { winner, timers: list<TimerRow>(r.timers), rules: list<PreviewRow>(r.rules) };
}

/** The plugin's own `util.parse_duration`: seconds, or null when the text is not a duration. */
export async function parseDuration(lua: Lua, value: string): Promise<number | null> {
  const [n] = await lua.call('util', 'parse_duration', value);
  return typeof n === 'number' ? n : null;
}

/** What `{time}` becomes after `seconds`, in the timer's format: the plugin's own `util.format_elapsed`. */
export async function elapsedExample(lua: Lua, format: string, seconds: number): Promise<string> {
  const [s] = await lua.call('util', 'format_elapsed', seconds, format);
  return typeof s === 'string' ? s : '';
}
