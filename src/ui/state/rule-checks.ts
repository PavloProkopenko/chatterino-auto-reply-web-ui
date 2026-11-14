import type { Condition, Rule } from '../../shared/config.ts';
import type { LuaClient } from '../../lua/client.ts';
import { nameCandidates } from './rules.ts';

type Lua = Pick<LuaClient, 'call'>;

export interface RuleAnalysis {
  id: number;
  replyError?: string;
  conditionError?: string;
  nameError?: string;
  /** Id of the earlier rule that wins this rule's own sample text (a hint, not a proof). */
  shadowedBy?: number;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []); // an empty Lua table comes back as {}

/** Reply, condition and name problems per rule, found by the plugin's own modules. */
export async function analyseRules(lua: Lua, rules: Rule[], me: string): Promise<Map<number, RuleAnalysis>> {
  const [raw] = await lua.call('uichecks', 'analyse', rules, me);
  const out = new Map<number, RuleAnalysis>();
  for (const r of list<Record<string, unknown>>(raw)) {
    const id = r.id as number;
    const a: RuleAnalysis = { id };
    const reply = text(r.reply_error);
    const cond = text(r.condition_error);
    const name = text(r.name_error);
    if (reply) a.replyError = reply;
    if (cond) a.conditionError = cond;
    if (name) a.nameError = name;
    if (typeof r.shadowed_by === 'number') a.shadowedBy = r.shadowed_by;
    out.set(id, a);
  }
  return out;
}

/** The plugin's message for a condition that cannot work, or null when it is fine. */
export async function checkCondition(lua: Lua, type: string, match?: string): Promise<string | null> {
  const [ok, err] = await lua.call('rules', 'validate', type, match);
  return ok === true ? null : (text(err) ?? 'ошибка');
}

export interface PreviewInput {
  text: string;
  channel: string;
  flags: string[];
  /** The streamer's own login, needed by "mention" conditions. */
  me: string;
}
export interface PreviewRow {
  id: number;
  active: boolean;
  applies: boolean;
  matched: boolean;
}
export interface PreviewResult {
  winner: number | null;
  rows: PreviewRow[];
}

/** Runs the list for one message in the plugin's own Lua; the first active, matching rule wins. */
export async function previewRules(lua: Lua, rules: Rule[], input: PreviewInput): Promise<PreviewResult> {
  const [raw] = await lua.call('uichecks', 'preview', rules, input.text, input.flags, input.me, input.channel);
  const r = (raw ?? {}) as { winner?: unknown; rows?: unknown };
  return { winner: typeof r.winner === 'number' ? r.winner : null, rows: list<PreviewRow>(r.rows) };
}

/** A free, valid name for a rule, built from its reply; null when the reply gives nothing usable. */
export async function suggestName(lua: Lua, others: { id: number; name?: unknown }[], reply: string, list: 'rules' | 'timers' | 'redeems' = 'rules'): Promise<string | null> {
  for (const candidate of nameCandidates(reply)) {
    const [ok] = await lua.call('names', 'check', others, candidate, list);
    if (ok === true) return candidate;
  }
  return null;
}

export type { Condition };
