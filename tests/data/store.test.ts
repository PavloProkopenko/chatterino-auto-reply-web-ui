import { beforeEach, describe, expect, test } from 'vitest';
import type { Config } from '../../src/shared/config.ts';
import { FileWriteError } from '../../src/ui/data/ports.ts';
import { createConfigStore, type ConfigStore } from '../../src/ui/data/store.ts';
import { MemoryBackups, MemoryFile } from './memory.ts';

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
      timers: [{ id: 1, channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: 'z' }], enabled: false }],
      ...over,
    },
    null,
    2,
  ) + '\n';

let file: MemoryFile;
let backups: MemoryBackups;
let clock: number;
let store: ConfigStore;
const make = (extra: Parameters<typeof createConfigStore>[0] extends infer O ? Partial<NonNullable<O>> : never = {}) =>
  createConfigStore({ file, backups, now: () => (clock += 1000), sleep: async () => {}, keepBackups: 20, ...extra });
const edit = (c: Config, fn: (c: Config) => void): Config => {
  const x = structuredClone(c);
  fn(x);
  return x;
};
async function loaded() {
  const r = await store.load();
  if (r.status !== 'ok') throw new Error('expected ok, got ' + r.status);
  return r;
}
const onDisk = () => JSON.parse(file.text!);

beforeEach(() => {
  file = new MemoryFile(fixture());
  backups = new MemoryBackups();
  clock = Date.UTC(2026, 10, 14);
  store = make();
});

describe('load', () => {
  test('ok: a content hash and the normalised config', async () => {
    const r = await loaded();
    expect(r.snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.config.ignore_users).toEqual([]);
  });
  test('the same text gives the same hash; different text a different one', async () => {
    const a = (await loaded()).snapshot.hash;
    expect((await loaded()).snapshot.hash).toBe(a);
    file.pluginSaves(fixture({ per_user_cooldown: 5 }));
    expect((await loaded()).snapshot.hash).not.toBe(a);
  });
  test('missing file', async () => {
    file = new MemoryFile(null);
    store = make();
    expect((await store.load()).status).toBe('missing');
  });
  test('invalid JSON is reported, not thrown, and the file is untouched', async () => {
    file = new MemoryFile('{broken');
    store = make();
    const r = await store.load();
    expect(r.status).toBe('invalid');
    expect(file.text).toBe('{broken');
    expect(file.writes).toBe(0);
  });
});

describe('save', () => {
  test('writes only the edited item and backs up the previous text', async () => {
    const text = file.text!;
    const l = await loaded();
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[1]!.reply = 'новый')));
    expect(r.status).toBe('saved');
    expect(file.text).toBe(text.replace('"два"', '"новый"'));
    expect(backups.entries).toHaveLength(1);
    expect(backups.entries[0]!.text).toBe(text);
  });

  test('keeps only the newest 20 backups', async () => {
    for (let i = 0; i < 25; i++) {
      const l = await loaded();
      expect((await store.save(l.snapshot.hash, edit(l.config, (c) => (c.per_user_cooldown = 100 + i)))).status).toBe('saved');
    }
    expect(backups.entries).toHaveLength(20);
  });

  test('the plugin saved meanwhile in another field: both changes end up in the file', async () => {
    const l = await loaded();
    const plugin = JSON.parse(fixture());
    plugin.timers[0].enabled = true;
    plugin.timers[0].started_at = 1700000000;
    file.pluginSaves(JSON.stringify(plugin, null, 2) + '\n');
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'моё')));
    expect(r.status).toBe('saved');
    expect(onDisk().rules[0].reply).toBe('моё');
    expect(onDisk().timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 });
    if (r.status === 'saved') expect(r.merged).toBe(true);
  });

  test("stale live state from the UI never overwrites the plugin's: the master switch stays as on disk", async () => {
    const l = await loaded();
    const plugin = JSON.parse(fixture());
    delete plugin.active_until;
    file.pluginSaves(JSON.stringify(plugin, null, 2) + '\n');
    await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 5)));
    expect('active_until' in onDisk()).toBe(false);
    expect(onDisk().global_min_gap).toBe(5);
  });

  test('the same field changed on both sides: conflict, nothing written, no backup', async () => {
    const l = await loaded();
    const plugin = JSON.parse(fixture());
    plugin.rules[1].reply = 'плагин';
    const pluginText = JSON.stringify(plugin, null, 2) + '\n';
    file.pluginSaves(pluginText);
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[1]!.reply = 'я')));
    expect(r.status).toBe('conflict');
    if (r.status === 'conflict') expect(r.conflicts[0]!.path).toBe('rules[2].reply');
    expect(file.text).toBe(pluginText);
    expect(file.writes).toBe(0);
    expect(backups.entries).toHaveLength(0);
  });

  test("after a conflict the plugin's version is a valid base for the next save", async () => {
    const l = await loaded();
    const plugin = JSON.parse(fixture());
    plugin.rules[1].reply = 'плагин';
    file.pluginSaves(JSON.stringify(plugin, null, 2) + '\n');
    const first = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[1]!.reply = 'я')));
    if (first.status !== 'conflict') throw new Error('expected a conflict');
    const second = await store.save(first.snapshot.hash, edit(first.theirs, (c) => (c.rules[1]!.reply = 'я')));
    expect(second.status).toBe('saved');
    expect(onDisk().rules[1].reply).toBe('я');
  });

  test('the plugin saves between our read and our write: detected and merged, never overwritten', async () => {
    const l = await loaded();
    let fired = false;
    store = make({
      hooks: {
        beforeCommit: async () => {
          if (fired) return;
          fired = true;
          const p = JSON.parse(fixture());
          p.timers[0].enabled = true;
          p.timers[0].started_at = 1700000001;
          file.pluginSaves(JSON.stringify(p, null, 2) + '\n');
        },
      },
    });
    await store.load();
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'моё')));
    expect(r.status).toBe('saved');
    expect(onDisk().rules[0].reply).toBe('моё');
    expect(onDisk().timers[0].started_at).toBe(1700000001);
  });

  test('if the file changes on every attempt it gives up with stale-base instead of looping or overwriting', async () => {
    const l = await loaded();
    let n = 0;
    store = make({
      hooks: {
        beforeCommit: async () => {
          const p = JSON.parse(fixture());
          p.timers[0].started_at = 1700000000 + n++;
          p.timers[0].enabled = true;
          file.pluginSaves(JSON.stringify(p, null, 2) + '\n');
        },
      },
    });
    await store.load();
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 9)));
    expect(r.status).toBe('stale-base');
    expect(n).toBe(3);
    expect(onDisk().global_min_gap).toBeUndefined();
  });

  test('an invalid file on disk is never overwritten', async () => {
    const l = await loaded();
    file.pluginSaves('{half a file');
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 9)));
    expect(r.status).toBe('invalid');
    expect(file.text).toBe('{half a file');
  });

  test('an unknown base hash asks the UI to reload', async () => {
    const l = await loaded();
    file.pluginSaves(fixture({ per_user_cooldown: 1 }));
    expect((await store.save('f'.repeat(64), l.config)).status).toBe('stale-base');
  });

  test('the file deleted meanwhile asks the UI to reload', async () => {
    const l = await loaded();
    file.text = null;
    expect((await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 9)))).status).toBe('stale-base');
  });
});

describe('writing can fail', () => {
  test('a busy file is retried with backoff and then succeeds', async () => {
    const l = await loaded();
    let failures = 2;
    file.failWith = () => (failures-- > 0 ? new FileWriteError('busy', 'file is busy') : null);
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 7)));
    expect(r.status).toBe('saved');
    expect(onDisk().global_min_gap).toBe(7);
  });

  test('a file that stays busy: write-failed with the text to offer as a download, original intact', async () => {
    const original = file.text;
    const l = await loaded();
    file.failWith = () => new FileWriteError('busy', 'locked');
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 7)));
    expect(r.status).toBe('write-failed');
    if (r.status === 'write-failed') {
      expect(r.reason).toBe('busy');
      expect(JSON.parse(r.text).global_min_gap).toBe(7);
    }
    expect(file.text).toBe(original);
  });

  test('a permission problem is not retried and is reported as such', async () => {
    const l = await loaded();
    let calls = 0;
    file.failWith = () => (calls++, new FileWriteError('permission', 'denied'));
    const r = await store.save(l.snapshot.hash, edit(l.config, (c) => (c.global_min_gap = 7)));
    expect(r.status).toBe('write-failed');
    if (r.status === 'write-failed') expect(r.reason).toBe('permission');
    expect(calls).toBe(1);
  });
});

describe('peek (cheap change detection)', () => {
  test('reports modified time and size, or null when the file is gone', async () => {
    const a = await store.peek();
    expect(a).toMatchObject({ modified: file.modified });
    file.pluginSaves(fixture({ per_user_cooldown: 1 }));
    expect((await store.peek())!.modified).toBeGreaterThan(a!.modified);
    file.text = null;
    expect(await store.peek()).toBeNull();
  });
});

describe('backups: list and restore', () => {
  test("restore brings back the old content but keeps the plugin's live state, and is itself backed up", async () => {
    let l = await loaded();
    await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'правка 1')));
    l = await loaded();
    await store.save(l.snapshot.hash, edit(l.config, (c) => (c.rules[0]!.reply = 'правка 2')));
    const live = onDisk();
    live.active_until = 1900000000;
    live.timers[0].enabled = true;
    live.timers[0].started_at = 1800000000;
    file.pluginSaves(JSON.stringify(live, null, 2) + '\n');

    const list = await store.listBackups();
    expect(list).toHaveLength(2);
    const oldest = list[list.length - 1]!.id;
    const r = await store.restore(oldest);
    expect(r.status).toBe('restored');
    expect(onDisk().rules[0].reply).toBe('один');
    expect(onDisk().active_until).toBe(1900000000);
    expect(onDisk().timers[0]).toMatchObject({ enabled: true, started_at: 1800000000 });
    expect(await store.listBackups()).toHaveLength(3);
  });

  test('an unknown backup id is refused', async () => {
    await expect(store.restore('nope')).rejects.toThrow(/backup/);
  });

  test('a backup that is not valid JSON is refused and nothing changes', async () => {
    const text = file.text;
    const id = await backups.add('{broken', clock);
    const r = await store.restore(id);
    expect(r.status).toBe('invalid');
    expect(file.text).toBe(text);
  });
});

describe('createDefault', () => {
  test('creates the plugin defaults when there is no file', async () => {
    file = new MemoryFile(null);
    store = make();
    const r = await store.createDefault();
    expect(r.status).toBe('created');
    expect(onDisk()).toMatchObject({ version: 1, per_user_cooldown: 60, backfire: true, channels: {} });
  });
  test('never overwrites an existing file', async () => {
    file = new MemoryFile('keep me');
    store = make();
    expect((await store.createDefault()).status).toBe('exists');
    expect(file.text).toBe('keep me');
  });
});
