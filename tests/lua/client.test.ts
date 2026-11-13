import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { createLuaClient, LuaTimeoutError, type WorkerHandle } from '../../src/lua/client.ts';
import { luaSources } from './sources.ts';

const entry = fileURLToPath(new URL('./node-worker.ts', import.meta.url));
let spawned = 0;
const spawn = (): WorkerHandle => {
  spawned++;
  const w = new Worker(entry, { execArgv: ['--experimental-strip-types', '--no-warnings'] });
  return {
    postMessage: (m) => w.postMessage(m),
    onMessage: (cb) => w.on('message', cb),
    onError: (cb) => w.on('error', cb),
    terminate: () => void w.terminate(),
  };
};

const client = createLuaClient({ spawn, sources: luaSources(), timeoutMs: 1000 });
afterAll(() => client.close());

describe('Lua client (worker + timeout)', () => {
  test('answers calls through the worker', async () => {
    expect(await client.call('rules', 'matches_one', { type: 'word', match: 'донат' }, 'нука, донат', 0, 'me')).toEqual([true]);
  });

  test('a malformed pattern returns false instead of throwing', async () => {
    expect(await client.call('rules', 'matches_one', { type: 'pattern', match: '[' }, 'x', 0, 'me')).toEqual([false]);
  });

  test('a catastrophic pattern times out, and the next call works on a fresh worker', async () => {
    const before = spawned;
    const t0 = Date.now();
    await expect(
      client.call('rules', 'matches_one', { type: 'pattern', match: 'a-a-a-a-a-a-a-a-a-a-b' }, 'a'.repeat(300), 0, 'me'),
    ).rejects.toBeInstanceOf(LuaTimeoutError);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(await client.call('rules', 'matches_one', { type: 'word', match: 'ок' }, 'ок', 0, 'me')).toEqual([true]);
    expect(spawned).toBe(before + 1);
  });

  test('sanitise works through the worker', async () => {
    const r = await client.sanitise('{"version":1,"channels":{}}');
    expect(r.config.version).toBe(1);
  });
});
