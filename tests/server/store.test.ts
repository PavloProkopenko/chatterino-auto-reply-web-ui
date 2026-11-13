import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Config } from '../../src/shared/config.ts';
import { createStore, type Store } from '../../src/server/store.ts';

let dir: string;
let file: string;
let clock = 0;
let store: Store;

const fixture = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      version: 1,
      active_until: 'forever',
      channels: ['a'],
      ignore_users: {},
      next_rule_id: 3,
      rules: [
        { id: 1, enabled: true, reply: 'один', channels: {}, conditions: [{ type: 'word', match: 'x' }] },
        { id: 2, enabled: true, reply: 'два', channels: {}, conditions: [{ type: 'word', match: 'y' }] },
      ],
      next_timer_id: 2,
      timers: [
        { id: 1, channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: 'z' }], enabled: false },
      ],
      ...over,
    },
    null,
    2,
  ) + '\n';

const names = async () => (await readdir(dir)).sort();
const read = () => readFile(file, 'utf8');
const edit = (c: Config, fn: (c: Config) => void): Config => {
  const x = structuredClone(c);
  fn(x);
  return x;
};
async function loaded() {
  const r = await store.load(file);
  if (r.status !== 'ok') throw new Error('expected ok, got ' + r.status);
  return r;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'store-'));
  file = join(dir, 'config.json');
  clock = Date.UTC(2026, 10, 14, 0, 0, 0);
  store = createStore({ now: () => (clock += 1000), keepBackups: 20, sleep: async () => {} });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('load', () => {
  test('ok: returns a hash snapshot and the normalised config', async () => {
    await writeFile(file, fixture());
    const r = await loaded();
    expect(r.snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.config.ignore_users).toEqual([]);
  });
  test('missing file', async () => {
    expect((await store.load(file)).status).toBe('missing');
  });
  test('invalid JSON is reported, not thrown, and the file is untouched', async () => {
    await writeFile(file, '{broken');
    const r = await store.load(file);
    expect(r.status).toBe('invalid');
    expect(await read()).toBe('{broken');
  });
  test('only a file named config.json is accepted', async () => {
    await expect(store.load(join(dir, 'other.json'))).rejects.toThrow(/config\.json/);
  });
});

describe('save', () => {
  test('writes only the edited item, backs up the previous file, leaves no temp files', async () => {
    const text = fixture();
    await writeFile(file, text);
    const l = await loaded();
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[1]!.reply = 'новый')));
    expect(r.status).toBe('saved');
    expect(await read()).toBe(text.replace('"два"', '"новый"'));
    const files = await names();
    const backups = files.filter((n) => n.startsWith('config.json.bak-'));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(dir, backups[0]!), 'utf8')).toBe(text);
    expect(files.filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  test('keeps only the newest 20 backups', async () => {
    await writeFile(file, fixture());
    for (let i = 0; i < 25; i++) {
      const l = await loaded();
      const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.per_user_cooldown = 100 + i)));
      expect(r.status).toBe('saved');
    }
    expect((await names()).filter((n) => n.startsWith('config.json.bak-'))).toHaveLength(20);
  });

  test('the plugin saved meanwhile in another field: both changes end up in the file', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    const pluginSaved = JSON.parse(fixture());
    pluginSaved.timers[0].enabled = true;
    pluginSaved.timers[0].started_at = 1700000000;
    await writeFile(file, JSON.stringify(pluginSaved, null, 2) + '\n');
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'моё')));
    expect(r.status).toBe('saved');
    const onDisk = JSON.parse(await read());
    expect(onDisk.rules[0].reply).toBe('моё');
    expect(onDisk.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 });
    if (r.status === 'saved') expect(r.merged).toBe(true);
  });

  test('stale live state from the UI never overwrites the plugin: the master switch stays as on disk', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    const pluginSaved = JSON.parse(fixture());
    delete pluginSaved.active_until;
    await writeFile(file, JSON.stringify(pluginSaved, null, 2) + '\n');
    await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 5)));
    const onDisk = JSON.parse(await read());
    expect('active_until' in onDisk).toBe(false);
    expect(onDisk.global_min_gap).toBe(5);
  });

  test('the same field changed on both sides: conflict, nothing written, no backup', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    const pluginSaved = JSON.parse(fixture());
    pluginSaved.rules[1].reply = 'плагин';
    const pluginText = JSON.stringify(pluginSaved, null, 2) + '\n';
    await writeFile(file, pluginText);
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[1]!.reply = 'я')));
    expect(r.status).toBe('conflict');
    if (r.status === 'conflict') expect(r.conflicts[0]!.path).toBe('rules[2].reply');
    expect(await read()).toBe(pluginText);
    expect((await names()).filter((n) => n.includes('.bak-'))).toEqual([]);
  });

  test('the plugin saves between our read and our rename: detected, merged, never overwritten', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    let fired = false;
    store = createStore({
      now: () => (clock += 1000),
      sleep: async () => {},
      hooks: {
        beforeCommit: async () => {
          if (fired) return;
          fired = true;
          const s = JSON.parse(fixture());
          s.timers[0].enabled = true;
          s.timers[0].started_at = 1700000001;
          await writeFile(file, JSON.stringify(s, null, 2) + '\n');
        },
      },
    });
    await store.load(file); // register the base text with this store instance
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'моё')));
    expect(r.status).toBe('saved');
    const onDisk = JSON.parse(await read());
    expect(onDisk.rules[0].reply).toBe('моё');
    expect(onDisk.timers[0].started_at).toBe(1700000001);
  });

  test('an invalid file on disk is never overwritten', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    await writeFile(file, '{half a file');
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 9)));
    expect(r.status).toBe('invalid');
    expect(await read()).toBe('{half a file');
  });

  test('an unknown base hash (for example after a restart) asks the UI to reload', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    const r = await store.save(file, 'f'.repeat(64), l.config);
    expect(r.status).toBe('stale-base');
  });

  test('Windows-style sharing errors are retried with backoff', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    let failures = 2;
    const { rename } = await import('node:fs/promises');
    store = createStore({
      now: () => (clock += 1000),
      sleep: async () => {},
      renameFile: async (a, b) => {
        if (failures-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        await rename(a, b);
      },
    });
    await store.load(file);
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 7)));
    expect(r.status).toBe('saved');
    expect(JSON.parse(await read()).global_min_gap).toBe(7);
  });

  test('a rename that keeps failing leaves the original intact and no temp file behind', async () => {
    const text = fixture();
    await writeFile(file, text);
    const l = await loaded();
    store = createStore({
      now: () => (clock += 1000),
      sleep: async () => {},
      renameFile: async () => {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      },
    });
    await store.load(file);
    await expect(store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 7)))).rejects.toThrow('locked');
    expect(await read()).toBe(text);
    expect((await names()).filter((n) => n.includes('.tmp'))).toEqual([]);
  });
});

describe('createDefault', () => {
  test('creates the plugin defaults when there is no file, creating data/ if needed', async () => {
    const target = join(dir, 'data', 'config.json');
    const r = await store.createDefault(target);
    expect(r.status).toBe('created');
    const cfg = JSON.parse(await readFile(target, 'utf8'));
    expect(cfg).toMatchObject({ version: 1, per_user_cooldown: 60, backfire: true, channels: {} });
  });
  test('never overwrites an existing file', async () => {
    await writeFile(file, 'keep me');
    expect((await store.createDefault(file)).status).toBe('exists');
    expect(await read()).toBe('keep me');
  });
});

describe('save under constant churn', () => {
  test('if the file changes on every attempt, it gives up with stale-base instead of looping or overwriting', async () => {
    await writeFile(file, fixture());
    const l = await loaded();
    let n = 0;
    store = createStore({
      now: () => (clock += 1000),
      sleep: async () => {},
      hooks: {
        beforeCommit: async () => {
          const s = JSON.parse(fixture());
          s.timers[0].started_at = 1700000000 + n++;
          s.timers[0].enabled = true;
          await writeFile(file, JSON.stringify(s, null, 2) + '\n');
        },
      },
    });
    await store.load(file);
    const r = await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 9)));
    expect(r.status).toBe('stale-base');
    expect(n).toBe(3);
    expect(JSON.parse(await read()).global_min_gap).toBeUndefined();
  });
});

describe('backups: list and restore', () => {
  test('lists newest first; restore brings back the old content but keeps the plugin\'s live state', async () => {
    await writeFile(file, fixture());
    let l = await loaded();
    await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'правка 1')));
    l = await loaded();
    await store.save(file, l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'правка 2')));
    // the plugin switches things on and starts the timer after our saves
    const live = JSON.parse(await read());
    live.active_until = 1900000000;
    live.timers[0].enabled = true;
    live.timers[0].started_at = 1800000000;
    await writeFile(file, JSON.stringify(live, null, 2) + '\n');

    const backups = await store.listBackups(file);
    expect(backups).toHaveLength(2);
    expect(backups[0]!.name > backups[1]!.name).toBe(true);
    const oldest = backups[1]!.name; // the very first version (reply "один")

    const r = await store.restore(file, oldest);
    expect(r.status).toBe('restored');
    const onDisk = JSON.parse(await read());
    expect(onDisk.rules[0].reply).toBe('один');
    expect(onDisk.active_until).toBe(1900000000);
    expect(onDisk.timers[0]).toMatchObject({ enabled: true, started_at: 1800000000 });
    expect(await store.listBackups(file)).toHaveLength(3); // restoring is itself backed up
  });

  test('rejects names that are not backups of this file (path traversal included)', async () => {
    await writeFile(file, fixture());
    for (const bad of ['../config.json', 'config.json', 'config.json.bak-../x', 'other.bak-1', '']) {
      await expect(store.restore(file, bad)).rejects.toThrow(/backup name/);
    }
  });

  test('a backup that is not valid JSON is refused and nothing changes', async () => {
    const text = fixture();
    await writeFile(file, text);
    await writeFile(join(dir, 'config.json.bak-20260101T000000000Z-000'), '{broken');
    const r = await store.restore(file, 'config.json.bak-20260101T000000000Z-000');
    expect(r.status).toBe('invalid');
    expect(await read()).toBe(text);
  });
});
