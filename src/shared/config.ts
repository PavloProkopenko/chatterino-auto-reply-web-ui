import { detectStyle, formatJson, type JsonStyle } from './json-style.ts';

export type JsonObject = { [key: string]: unknown };

export interface Condition {
  type: string;
  match?: string;
  [key: string]: unknown;
}

export interface Rule {
  id: number;
  name?: string;
  enabled: boolean;
  reply: string;
  channels: string[];
  conditions: Condition[];
  skip_mods?: boolean;
  skip_users?: string[];
  [key: string]: unknown;
}

export interface Timer {
  id: number;
  name?: string;
  channel: string;
  reply: string;
  format: string;
  on_category: string;
  conditions: Condition[];
  skip_mods?: boolean;
  skip_users?: string[];
  /** Live state, owned by the plugin. */
  enabled: boolean;
  started_at?: number;
  game_id?: string;
  [key: string]: unknown;
}

export interface Redeem {
  id: number;
  name?: string;
  channel: string;
  title: string;
  action: string;
  seconds?: number;
  enabled: boolean;
  [key: string]: unknown;
}

/** Normalised view of config.json: lists are arrays, legacy shapes are converted, unknown keys are kept. */
export interface Config {
  version: number;
  /** Live state (master switch), owned by the plugin: nil | "forever" | unix seconds. */
  active_until?: string | number;
  channels: string[];
  ignore_users: string[];
  protect_users: string[];
  /** Mute exceptions (plugin 0.9.0): may be muted although a badge, `protect_users` or a bot says otherwise. */
  unprotect_users: string[];
  per_user_cooldown: number;
  per_rule_cooldown: number;
  global_min_gap: number;
  only_when_live: boolean;
  skip_mods: boolean;
  mute_lurkers: boolean;
  backfire: boolean;
  helix_enabled: boolean;
  next_rule_id: number;
  rules: Rule[];
  next_timer_id: number;
  timers: Timer[];
  next_redeem_id: number;
  redeems: Redeem[];
  [key: string]: unknown;
}

/** Mirrors `config.defaults()` in the plugin; a contract test compares it with the real Lua. */
export const DEFAULTS = {
  version: 1,
  channels: [],
  ignore_users: [],
  protect_users: [],
  unprotect_users: [],
  per_user_cooldown: 60,
  per_rule_cooldown: 10,
  global_min_gap: 1,
  only_when_live: false,
  skip_mods: false,
  mute_lurkers: false,
  backfire: true,
  helix_enabled: false,
  next_rule_id: 1,
  rules: [],
  next_timer_id: 1,
  timers: [],
  next_redeem_id: 1,
  redeems: [],
} as const;

/** A parsed file plus what is needed to write it back with a minimal diff. */
export interface ConfigDoc {
  /** The parsed JSON exactly as found on disk. */
  base: JsonObject;
  style: JsonStyle;
  /** True when re-emitting `base` reproduces the file byte for byte. */
  exact: boolean;
}

export type ParseResult = { ok: true; doc: ConfigDoc } | { ok: false; error: string };

export function parseDoc(text: string): ParseResult {
  const style = detectStyle(text);
  if (text.trim() === '') return { ok: true, doc: { base: {}, style, exact: false } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'config.json must contain a JSON object' };
  }
  const base = parsed as JsonObject;
  return { ok: true, doc: { base, style, exact: formatJson(base, style) === text } };
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{}` (the plugin's empty list) and anything that is not an array read as an empty list. */
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normaliseConditions(item: JsonObject): void {
  const existing = asList(item.conditions);
  if (existing.length > 0) {
    item.conditions = existing;
    return;
  }
  // Same order as `rules.conditions` in the plugin: a `type` wins over a bare `trigger`.
  if (item.type !== undefined || typeof item.trigger !== 'string') {
    item.conditions = typeof item.type === 'string' ? [{ type: item.type, ...(item.match !== undefined ? { match: item.match } : {}) }] : [];
  } else {
    item.conditions = [{ type: 'word', match: item.trigger }];
  }
  delete item.type;
  delete item.match;
  delete item.trigger;
}

export function normaliseRule(raw: unknown): Rule {
  const item = isObject(raw) ? { ...raw } : {};
  normaliseConditions(item);
  item.channels = asList(item.channels);
  if ('skip_users' in item) item.skip_users = asList(item.skip_users);
  return item as Rule;
}

export function normaliseTimer(raw: unknown): Timer {
  const item = isObject(raw) ? { ...raw } : {};
  normaliseConditions(item);
  if ('skip_users' in item) item.skip_users = asList(item.skip_users);
  return item as Timer;
}

export function normaliseRedeem(raw: unknown): Redeem {
  return (isObject(raw) ? { ...raw } : {}) as Redeem;
}

export function normalise(base: JsonObject): Config {
  const cfg: JsonObject = { ...structuredClone(DEFAULTS), ...structuredClone(base) };
  for (const key of ['channels', 'ignore_users', 'protect_users', 'unprotect_users'] as const) cfg[key] = asList(cfg[key]);
  cfg.rules = asList(cfg.rules).map(normaliseRule);
  cfg.timers = asList(cfg.timers).map(normaliseTimer);
  cfg.redeems = asList(cfg.redeems).map(normaliseRedeem);
  return cfg as Config;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => k in (b as object) && deepEqual((a as JsonObject)[k], (b as JsonObject)[k]));
}

/** Empty arrays become `{}`, as the plugin's serializer writes them. Applied only to values the user edited. */
export function toPluginShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? {} : value.map(toPluginShape);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPluginShape(v)]));
  return value;
}

const ITEM_LISTS: Record<string, (raw: unknown) => unknown> = {
  rules: normaliseRule,
  timers: normaliseTimer,
  redeems: normaliseRedeem,
};

function renderItems(baseList: unknown[], edited: unknown[], norm: (raw: unknown) => unknown): unknown {
  const byId = new Map<unknown, unknown>();
  baseList.forEach((b) => isObject(b) && typeof b.id === 'number' && byId.set(b.id, b));
  const out = edited.map((item, index) => {
    const id = isObject(item) ? item.id : undefined;
    const baseItem = typeof id === 'number' ? byId.get(id) : baseList[index];
    // Untouched items are emitted exactly as found (legacy shapes, `{}` lists and all).
    if (baseItem !== undefined && deepEqual(norm(baseItem), item)) return baseItem;
    return toPluginShape(item);
  });
  return out.length === 0 ? {} : out;
}

/** Text for `edited` (a changed copy of `normalise(doc.base)`), laid out like the original file. */
export function render(doc: ConfigDoc, edited: Config): string {
  const normBase = normalise(doc.base);
  const keys = [...Object.keys(doc.base), ...Object.keys(edited).filter((k) => !(k in doc.base))];
  const out: JsonObject = {};
  for (const key of keys) {
    if (!(key in edited)) continue; // explicitly removed
    const value = edited[key];
    const inBase = key in doc.base;
    if (deepEqual(normBase[key], value)) {
      if (inBase) out[key] = doc.base[key]; // untouched: keep the original value
      continue; // a default the file never had: do not add it
    }
    const norm = ITEM_LISTS[key];
    out[key] = norm && Array.isArray(value) ? renderItems(asList(doc.base[key]), value, norm) : toPluginShape(value);
  }
  return formatJson(out, doc.style);
}

/** Text of a brand-new config: the plugin's defaults, pretty-printed, empty lists as `{}`. */
export function defaultConfigText(): string {
  return formatJson(toPluginShape(structuredClone(DEFAULTS)), { indent: 2, eol: '\n', trailingNewline: true });
}
