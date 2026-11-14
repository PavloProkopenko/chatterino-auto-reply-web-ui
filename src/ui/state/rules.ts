import type { Condition, Config, Rule } from '../../shared/config.ts';
import { addRule } from '../../shared/ids.ts';
import { deleteItems, moveStep, moveTo } from './lists.ts';

/** A rule's fields as the constructor edits them (`Omit<Rule, 'id'>` would erase the property types behind its index signature). */
export interface RuleFields {
  name?: string;
  enabled: boolean;
  reply: string;
  channels: string[];
  conditions: Condition[];
  skip_mods?: boolean;
  skip_users?: string[];
  [key: string]: unknown;
}
export type RuleDraft = RuleFields & { id?: number };

/** A blank rule as the constructor starts it: on, for every channel, one empty "whole word" condition. */
export function emptyRule(): RuleFields {
  return { enabled: true, reply: '', channels: [], conditions: [{ type: 'word', match: '' }] };
}

const OPTIONAL = ['name', 'skip_mods', 'skip_users'] as const;

/**
 * Adds a rule (it takes `next_rule_id`) or, when `rule.id` exists, replaces that rule in place. Keys the app does not
 * know are kept; optional keys the edit no longer has are removed. Returns the rule's id.
 */
export function saveRule(cfg: Config, rule: RuleDraft): number {
  const index = rule.id === undefined ? -1 : cfg.rules.findIndex((r) => r.id === rule.id);
  if (index < 0) {
    const draft: Omit<Rule, 'id'> = { ...rule };
    delete (draft as { id?: number }).id;
    return addRule(cfg, draft).id;
  }
  const next: Rule = { ...(cfg.rules[index] as Rule), ...(rule as Rule) };
  for (const key of OPTIONAL) if (!(key in rule)) delete next[key];
  cfg.rules[index] = next;
  return next.id;
}

/** Removes rules; the counter stays, so their ids are never handed out again. Returns how many were removed. */
export const deleteRules = (cfg: Config, ids: number[]): number => deleteItems(cfg, 'rules', ids);

/** One step up (-1) or down (+1); list order is priority. */
export const moveRule = (cfg: Config, id: number, delta: -1 | 1): void => moveStep(cfg, 'rules', id, delta);

/** Drag and drop: the rule takes the place of the row it was dropped on (after it when moving down, before it when moving up). */
export const moveRuleTo = (cfg: Config, id: number, targetId: number): void => moveTo(cfg, 'rules', id, targetId);

/** The chosen rules go to the top or bottom, keeping their order among themselves. */
export function moveToEdge(cfg: Config, ids: number[], edge: 'top' | 'bottom'): void {
  const chosen = new Set(ids);
  const picked = cfg.rules.filter((r) => chosen.has(r.id));
  const rest = cfg.rules.filter((r) => !chosen.has(r.id));
  cfg.rules.splice(0, cfg.rules.length, ...(edge === 'top' ? [...picked, ...rest] : [...rest, ...picked]));
}

export function setRulesEnabled(cfg: Config, ids: number[], enabled: boolean): void {
  const chosen = new Set(ids);
  for (const r of cfg.rules) if (chosen.has(r.id)) r.enabled = enabled;
}

const NAME_MAX = 20;

/**
 * Name ideas from a reply: the first word, then the first two words joined with "-". Only the alphabet the plugin
 * accepts (letters, digits, `_`, `-`, at least one letter). The caller checks them against the plugin's own rules.
 */
export function nameCandidates(reply: string): string[] {
  const words = reply
    .replace(/\{[a-z]+\}/gi, ' ')
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((w) => /\p{L}/u.test(w));
  const cut = (s: string) => [...s].slice(0, NAME_MAX).join('');
  const out: string[] = [];
  const first = words[0];
  if (first) out.push(cut(first));
  const second = words[1];
  if (first && second) out.push(cut(`${first}-${second}`));
  return [...new Set(out)];
}
