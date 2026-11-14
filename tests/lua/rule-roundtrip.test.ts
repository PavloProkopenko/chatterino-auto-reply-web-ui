import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { defaultConfigText, normalise, parseDoc, render, type Condition } from '../../src/shared/config.ts';
import { saveRedeem, emptyRedeem, type RedeemDraft } from '../../src/ui/state/redeems.ts';
import { saveRule, type RuleDraft } from '../../src/ui/state/rules.ts';
import { emptyTimer, saveTimer, startTimer, type TimerDraft } from '../../src/ui/state/timers.ts';
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

async function viaPluginLists(build: (cfg: ReturnType<typeof normalise>) => void) {
  const doc = parseDoc(defaultConfigText());
  if (!doc.ok) throw new Error(doc.error);
  const cfg = normalise(doc.doc.base);
  cfg.channels = ['streamer'];
  build(cfg);
  const s = await host.sanitise(render(doc.doc, cfg));
  return { warning: s.warning, timers: (s.config.timers ?? []) as Record<string, unknown>[], redeems: (s.config.redeems ?? []) as Record<string, unknown>[] };
}

const timerDraft = (more: Partial<TimerDraft> = {}): TimerDraft => ({ ...emptyTimer('streamer'), reply: 'играет уже {time}', conditions: [word('!game')], ...more });
const redeemDraft = (more: Partial<RedeemDraft> = {}): RedeemDraft => ({ ...emptyRedeem('streamer'), title: 'Мут чудили', seconds: 600, ...more });

describe('timers and redeems built by the constructor pass the plugin\'s config.load', () => {
  test('timers: created off, chained conditions, both formats, every category behaviour, name and skip options', async () => {
    const drafts = [
      timerDraft(),
      timerDraft({ format: 'full', on_category: 'stop', conditions: [word('!время'), { type: 'flag', match: 'first' }], name: 'game', skip_mods: true, skip_users: ['bot_one'] }),
      timerDraft({ on_category: 'off', conditions: [{ type: 'anyword', match: '!game|!игра' }] }),
    ];
    let ids: number[] = [];
    const r = await viaPluginLists((cfg) => void (ids = drafts.map((d) => saveTimer(cfg, d))));
    expect(r.timers).toHaveLength(3);
    for (const [i, d] of drafts.entries()) {
      expect(r.timers[i]).toMatchObject({ id: ids[i], enabled: false, channel: 'streamer', reply: d.reply, format: d.format, on_category: d.on_category, conditions: d.conditions });
      expect(r.timers[i]).not.toHaveProperty('started_at');
    }
    expect(r.timers[1]).toMatchObject({ name: 'game', skip_mods: true, skip_users: ['bot_one'] });
  });

  test('a timer started from the site keeps running through config.load', async () => {
    const r = await viaPluginLists((cfg) => {
      const id = saveTimer(cfg, timerDraft());
      startTimer(cfg, id, 1_800_000_000);
    });
    expect(r.timers[0]).toMatchObject({ enabled: true, started_at: 1_800_000_000 });
  });

  test('redeems: timeout with every kind of duration, and unmute without one', async () => {
    const drafts = [redeemDraft(), redeemDraft({ title: 'Долгий', seconds: 1_209_600, name: 'long' }), redeemDraft({ title: 'Анмут чудилы', action: 'untimeout' }), redeemDraft({ title: 'Выключен', enabled: false })];
    let ids: number[] = [];
    const r = await viaPluginLists((cfg) => void (ids = drafts.map((d) => saveRedeem(cfg, d))));
    expect(r.redeems).toHaveLength(4);
    expect(r.redeems[0]).toMatchObject({ id: ids[0], channel: 'streamer', title: 'Мут чудили', action: 'timeout', seconds: 600, enabled: true });
    expect(r.redeems[1]).toMatchObject({ seconds: 1_209_600, name: 'long' });
    expect(r.redeems[2]).toMatchObject({ action: 'untimeout' });
    expect(r.redeems[2]).not.toHaveProperty('seconds');
    expect(r.redeems[3]).toMatchObject({ enabled: false });
  });

  test('controls: the plugin does stop a running timer with a bad condition and drops a redeem without a title or duration', async () => {
    const r = await viaPluginLists((cfg) => {
      const bad = saveTimer(cfg, timerDraft({ conditions: [{ type: 'flag', match: 'nope' }] }));
      startTimer(cfg, bad, 1_800_000_000);
      saveRedeem(cfg, redeemDraft({ title: '' }));
      saveRedeem(cfg, redeemDraft({ title: 'без времени', seconds: 0 }));
      saveRedeem(cfg, redeemDraft({ title: 'нормальная' }));
    });
    expect(r.timers[0]).toMatchObject({ enabled: false });
    expect(r.timers[0]).not.toHaveProperty('started_at');
    expect(r.redeems).toHaveLength(1);
    expect(r.redeems[0]).toMatchObject({ title: 'нормальная' });
  });
});
