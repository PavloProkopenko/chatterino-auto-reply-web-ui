import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { defaultConfigText, normalise, parseDoc, render, type Condition } from '../../src/shared/config.ts';
import { saveRule, type RuleDraft } from '../../src/ui/state/rules.ts';
import { luaSources } from './sources.ts';

// Acceptance: what the constructor builds is accepted by the plugin's own config.load (its sanitiser would drop or
// disable anything it dislikes), for every condition type and every optional rule field.
let host: LuaHost;
beforeAll(async () => {
  host = await createLuaHost(luaSources());
});
afterAll(() => host.close());

async function viaPlugin(drafts: RuleDraft[]) {
  const text = defaultConfigText();
  const doc = parseDoc(text);
  if (!doc.ok) throw new Error(doc.error);
  const cfg = normalise(doc.doc.base);
  cfg.channels = ['streamer', 'other'];
  const ids = drafts.map((d) => saveRule(cfg, d));
  const out = render(doc.doc, cfg);
  const s = await host.sanitise(out);
  return { ids, out, warning: s.warning, bad: s.badCopy, rules: (s.config.rules ?? []) as Record<string, unknown>[] };
}

const word = (match: string): Condition => ({ type: 'word', match });
const base = (conditions: Condition[], more: Partial<RuleDraft> = {}): RuleDraft => ({ enabled: true, reply: 'Ответ, {user}!', channels: [], conditions, ...more });

describe('rules built by the constructor pass the plugin\'s config.load', () => {
  test('every condition type, alone and chained', async () => {
    const drafts = [
      base([word('привет')]),
      base([{ type: 'keyword', match: '!дс' }]),
      base([{ type: 'anyword', match: '!донат|!donate' }]),
      base([{ type: 'mention' }]),
      base([{ type: 'flag', match: 'first' }]),
      base([{ type: 'pattern', match: '^!%a+$' }]),
      base([word('привет'), { type: 'flag', match: 'sub' }, { type: 'mention' }]),
    ];
    const r = await viaPlugin(drafts);
    expect(r.warning).toBeNull();
    expect(r.bad).toBeNull();
    expect(r.rules).toHaveLength(drafts.length);
    for (const [i, d] of drafts.entries()) {
      expect(r.rules[i]).toMatchObject({ id: r.ids[i], enabled: true, reply: d.reply, conditions: d.conditions });
    }
  });

  test('name, channel scope, skip options and a switched-off rule', async () => {
    const r = await viaPlugin([
      base([word('a')], { name: 'greet', channels: ['streamer'], skip_mods: true, skip_users: ['bot_one'], enabled: false }),
      base([word('b')], { skip_mods: false }),
    ]);
    expect(r.warning).toBeNull();
    expect(r.rules[0]).toMatchObject({ name: 'greet', channels: ['streamer'], skip_mods: true, skip_users: ['bot_one'], enabled: false });
    expect(r.rules[1]).toMatchObject({ skip_mods: false });
    expect(r.rules[1]).not.toHaveProperty('name');
  });

  test('the file the app writes is the same list, in the same order, with the counter ahead of every id', async () => {
    const r = await viaPlugin([base([word('x')]), base([word('y')]), base([word('z')])]);
    expect(r.rules.map((x) => x.id)).toEqual(r.ids);
    expect(JSON.parse(r.out).next_rule_id).toBe(Math.max(...r.ids) + 1);
  });

  test('control: the plugin does disable a rule it dislikes (an unusable channel), so the checks above can fail', async () => {
    // config.load validates rule channels but not rule conditions: a bad condition just never matches (the UI warns about it itself)
    const r = await viaPlugin([base([word('a')], { channels: ['bad name!'] }), base([word('ok')])]);
    expect(r.rules.find((x) => x.id === r.ids[0])).toMatchObject({ enabled: false });
    expect(r.rules.find((x) => x.id === r.ids[1])).toMatchObject({ enabled: true });
  });
});
