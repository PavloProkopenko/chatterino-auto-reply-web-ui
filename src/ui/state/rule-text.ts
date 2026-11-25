import { ru } from '../../i18n/ru.ts';
import type { Condition, Rule } from '../../shared/config.ts';
import type { Features } from '../../shared/features.ts';

const T = ru.rules;

/** One condition in plain Russian; the text is the user's own, so it is shown as given. */
export function describeCondition(c: Condition): string {
  const m = typeof c.match === 'string' ? c.match : '';
  switch (c.type) {
    case 'keyword':
      return m ? T.describe.keyword(m) : T.describe.empty;
    case 'word':
      return m ? T.describe.word(m) : T.describe.empty;
    case 'anyword': {
      const parts = m.split('|').map((x) => x.trim()).filter(Boolean);
      return parts.length ? T.describe.anyword(parts.join(', ')) : T.describe.empty;
    }
    case 'noword': {
      const parts = m.split('|').map((x) => x.trim()).filter(Boolean);
      return parts.length ? T.describe.noword(parts.join(', ')) : T.describe.empty;
    }
    case 'mention':
      return T.describe.mention;
    case 'flag':
      return T.flags[m] ?? T.describe.empty;
    case 'pattern':
      return m ? T.describe.pattern(m) : T.describe.empty;
    default:
      return T.describe.unknown(String(c.type));
  }
}

export const describeConditions = (rule: { conditions: Condition[] }): string => rule.conditions.map(describeCondition).join(T.describe.and);

/** The name when there is one, else the id as the plugin's chat commands write it. */
export const ruleLabel = (rule: Pick<Rule, 'id' | 'name'>): string => (typeof rule.name === 'string' && rule.name !== '' ? rule.name : `#${rule.id}`);

export function replyStart(reply: string, max = 70): string {
  const chars = [...reply.replace(/\s+/g, ' ').trim()];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Channels the rule is bound to that the global channel list does not contain (case-insensitive). */
export function missingChannels(rule: Rule, channels: string[]): { missing: string[]; all: boolean } {
  const known = new Set(channels.map((c) => c.toLowerCase()));
  const missing = rule.channels.filter((c) => !known.has(c.toLowerCase()));
  return { missing, all: rule.channels.length > 0 && missing.length === rule.channels.length };
}

/** Features the rule uses that the plugin version cannot handle (CONTRACT section 5). */
export function gatingProblems(rule: Rule, f: Features): string[] {
  const out: string[] = [];
  const usesName = typeof rule.name === 'string' && rule.name !== '';
  const usesChannels = rule.channels.length > 0;
  const usesSkip = rule.skip_mods !== undefined || (Array.isArray(rule.skip_users) && rule.skip_users.length > 0);
  if (usesName && !f.names) out.push(f.versionKnown ? T.warn.needsName('0.2.1') : T.warn.unknownName);
  if (usesChannels && !f.ruleChannels) out.push(f.versionKnown ? T.warn.needsChannels('0.3.0') : T.warn.unknownChannels);
  if (usesSkip && !f.skipUsers) out.push(f.versionKnown ? T.warn.needsSkip('0.5.0') : T.warn.unknownSkip);
  return out;
}
