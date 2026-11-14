import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { normalise } from '../../src/shared/config.ts';
import { previewAll } from '../../src/ui/state/timer-checks.ts';
import { luaSources } from './sources.ts';

// Dev-only cross-check (PLUGIN_REPO). The plugin repo's labelled chat fixture says, per message, whether a reply is
// expected and of which kind. This replays it through the UI's preview with the same spec as the plugin's
// tests/cases/spec_labels.lua (`lua tests/run.lua`): every labelled "reply" message must be won by a rule of the right
// kind, every other message by none. The fixture's timer is running, so timers answer first, as in the plugin. Cooldowns are
// not simulated, so every labelled timer question the plugin could answer is answered here. Nothing from the fixtures is
// copied into this repo or printed beyond counts and message text of failures.
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

    expect(config.timers.length).toBeGreaterThan(0);
    const startedAt = config.timers[0]!.started_at as number;
    const falsePositives: string[] = [];
    const misses: string[] = [];
    const wrongKind: string[] = [];
    let positives = 0;
    let timerQuestions = 0;
    let firstTimerText: string | null = null;
    const lines = readFileSync(resolve(fixtures, 'chat.log'), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const m = /^\[[^\]]+\] #(\S+) (\S+?): ?(.*)$/.exec(line);
      if (!m || m[2] === 'inflame_dt') continue; // the streamer's own bot lines are not part of the feed
      const label = labels.get(i + 1);
      const stamp = /^\[(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)\]/.exec(line)!;
      const at = Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6])) / 1000;
      const p = await previewAll(host, config.timers, config.rules, { text: m[3]!, channel: m[1]!, flags: [], me: 'inflame_dt', elapsedSeconds: Math.max(0, at - startedAt) });
      const w = p.winner;
      const won = w === null ? undefined : (w.kind === 'timer' ? config.timers : config.rules).find((x) => x.id === w.id);
      if (w?.kind === 'timer' && label?.kind === 'timer' && label.expect === 'reply') {
        timerQuestions++;
        firstTimerText ??= won!.reply.replaceAll('{time}', w.time ?? '');
      }
      if (label?.expect === 'reply') {
        positives++;
        if (!won) misses.push(`[${label.kind}] ${m[3]}`);
        else if (kindOf(won.reply) !== label.kind) wrongKind.push(`[${label.kind} -> ${kindOf(won.reply)}] ${m[3]}`);
      } else if (won) falsePositives.push(`[${kindOf(won.reply)}] ${m[3]}`);
    }
    expect(positives).toBeGreaterThan(50);
    expect({ falsePositives, wrongKind, misses }).toEqual({ falsePositives: [], wrongKind: [], misses: [] });
    // The plugin's own spec: 36 labelled timer questions, and the first answer reads "играет уже 1 ч 6 мин".
    expect(timerQuestions).toBe(36);
    expect(firstTimerText).toMatch(/играет уже 1 ч 6 мин$/);
  });
});
