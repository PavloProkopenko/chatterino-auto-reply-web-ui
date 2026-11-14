import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { normalise } from '../../src/shared/config.ts';
import { previewRules } from '../../src/ui/state/rule-checks.ts';
import { luaSources } from './sources.ts';

// Dev-only cross-check (PLUGIN_REPO). The plugin repo's labelled chat fixture says, per message, whether a reply is
// expected and of which kind. This replays it through the UI's preview with the same spec as the plugin's
// tests/cases/spec_labels.lua (`lua tests/run.lua`): every labelled "reply" message must be won by a rule of the right
// kind, every other message by none. Timers are not simulated by the preview, so they are left out, as in that spec when
// no timer is running. Nothing from the fixtures is copied into this repo or printed beyond counts and message text of failures.
const repo = resolve(process.env.PLUGIN_REPO ?? '../auto-reply-plugin');
const fixtures = resolve(repo, 'auto-reply/tests/fixtures');
const available = ['chat.log', 'labels.lua', 'config.fixed.json'].every((f) => existsSync(resolve(fixtures, f)));

const kindOf = (reply: string) => (reply.includes('donatepay') ? 'donate' : reply.includes('spotify') ? 'playlist' : reply.includes('играет уже') ? 'timer' : 'other');

describe.skipIf(!available)('labelled chat through the preview (PLUGIN_REPO)', () => {
  let host: LuaHost;
  beforeAll(async () => {
    host = await createLuaHost(luaSources());
  });
  afterAll(() => host.close());

  test('donate, playlist and timer scenarios give the results the plugin\'s spec expects', async () => {
    const config = normalise(JSON.parse(readFileSync(resolve(fixtures, 'config.fixed.json'), 'utf8')));
    const labels = new Map<number, { kind: string; expect: string }>();
    for (const m of readFileSync(resolve(fixtures, 'labels.lua'), 'utf8').matchAll(/line = (\d+), kind = "(\w+)", expect = "(\w+)"/g)) labels.set(Number(m[1]), { kind: m[2]!, expect: m[3]! });
    expect(labels.size).toBeGreaterThan(100);

    const falsePositives: string[] = [];
    const misses: string[] = [];
    const wrongKind: string[] = [];
    let positives = 0;
    const lines = readFileSync(resolve(fixtures, 'chat.log'), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const m = /^\[[^\]]+\] #(\S+) (\S+?): ?(.*)$/.exec(line);
      if (!m || m[2] === 'inflame_dt') continue; // the streamer's own bot lines are not part of the feed
      const label = labels.get(i + 1);
      const p = await previewRules(host, config.rules, { text: m[3]!, channel: m[1]!, flags: [], me: 'inflame_dt' });
      const won = p.winner === null ? undefined : config.rules.find((r) => r.id === p.winner);
      if (label?.expect === 'reply') {
        positives++;
        if (!won) misses.push(`[${label.kind}] ${m[3]}`);
        else if (kindOf(won.reply) !== label.kind && label.kind !== 'timer') wrongKind.push(`[${label.kind} -> ${kindOf(won.reply)}] ${m[3]}`);
      } else if (won) falsePositives.push(`[${kindOf(won.reply)}] ${m[3]}`);
    }
    expect(positives).toBeGreaterThan(50);
    expect({ falsePositives, wrongKind }).toEqual({ falsePositives: [], wrongKind: [] });
    // Messages labelled for a timer to answer are not rules' business; every other labelled reply needs a winning rule.
    expect(misses.filter((x) => !x.startsWith('[timer]'))).toEqual([]);
  });
});
