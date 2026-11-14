import { describe, expect, test } from 'vitest';
import { openPersistence } from '../../src/ui/data/persistence.ts';
import { createWorkspace, type Workspace } from '../../src/ui/data/workspace.ts';

const downloads: { name: string; text: string }[] = [];
async function make(): Promise<Workspace> {
  downloads.length = 0;
  // no indexedDB in Node: persistence falls back to memory, which is exactly the private-window behaviour
  return createWorkspace({ persistence: await openPersistence(), download: (name, text) => void downloads.push({ name, text }), directAccess: false });
}
const file = (name: string, text: string, relative?: string) => {
  const f = new File([text], name, { lastModified: 1_700_000_000_000 });
  if (relative) Object.defineProperty(f, 'webkitRelativePath', { value: relative });
  return f;
};
const cfg = JSON.stringify({ version: 1, channels: ['a'] }, null, 2) + '\n';
const info = (name = 'Auto Reply', version = '0.5.0') => JSON.stringify({ name, version });

describe('re-opening the current file before a download', () => {
  test('an opened file can be replaced by a newer one; the next load sees the newer text', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('config.json', cfg)]);
    if (r.status !== 'picked') throw new Error('expected picked');
    expect(r.source.needsFreshFile).toBe(true);
    const newer = JSON.stringify({ version: 1, channels: ['a', 'b'] }, null, 2) + '\n';
    expect(await r.source.replaceFile!(file('config (1).json', newer))).toEqual({ status: 'replaced' });
    const l = await r.source.store.load();
    expect(l.status === 'ok' && l.config.channels).toEqual(['a', 'b']);
  });

  test('a file that is not JSON is refused and the open file stays as it was', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('config.json', cfg)]);
    if (r.status !== 'picked') throw new Error('expected picked');
    expect(await r.source.replaceFile!(file('config.json', '{nope'))).toEqual({ status: 'unreadable' });
    const l = await r.source.store.load();
    expect(l.status === 'ok' && l.config.channels).toEqual(['a']);
  });

  test('the sample and direct sources need no re-open; the plugin folder name is kept for the copy command', async () => {
    const ws = await make();
    expect(ws.startDemo().needsFreshFile).toBe(false);
    const r = await ws.openFiles([file('info.json', info(), 'auto-reply/info.json'), file('config.json', cfg, 'auto-reply/data/config.json')]);
    if (r.status !== 'picked') throw new Error('expected picked');
    expect(r.source.folderName).toBe('auto-reply');
    const single = await ws.openFiles([file('config.json', cfg)]);
    if (single.status === 'picked') expect(single.source.folderName).toBeNull();
  });
});

describe('info.json opened as a second file', () => {
  const open = async () => {
    const ws = await make();
    const r = await ws.openFiles([file('config.json', cfg)]);
    if (r.status !== 'picked') throw new Error('expected picked');
    return r.source;
  };

  test('gives the plugin version and turns the version-gated settings on', async () => {
    const source = await open();
    expect(source.features.versionKnown).toBe(false);
    expect(await source.applyInfo!(file('info.json', info('Auto Reply', '0.5.0')))).toEqual({ status: 'applied' });
    expect(source.pluginVersion).toBe('0.5.0');
    expect(source.features).toMatchObject({ versionKnown: true, skipUsers: true });
  });

  test('an older plugin version keeps newer settings off', async () => {
    const source = await open();
    await source.applyInfo!(file('info.json', info('Auto Reply', '0.2.1')));
    expect(source.features).toMatchObject({ versionKnown: true, names: true, skipUsers: false });
  });

  test('another plugin\'s file, or something that is not info.json, changes nothing', async () => {
    const source = await open();
    expect(await source.applyInfo!(file('info.json', info('Something Else')))).toEqual({ status: 'not-plugin' });
    expect(await source.applyInfo!(file('info.json', '{nope'))).toEqual({ status: 'unreadable' });
    expect(await source.applyInfo!(file('info.json', JSON.stringify({ name: 'Auto Reply' })))).toEqual({ status: 'unreadable' });
    expect(source.pluginVersion).toBeNull();
    expect(source.features.versionKnown).toBe(false);
  });

  test('the sample has no such step', async () => {
    const ws = await make();
    expect(ws.startDemo().applyInfo).toBeUndefined();
  });
});

describe('openFiles (the Firefox/Safari path)', () => {
  test('a plugin folder gives the version from info.json and the config from data/', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('info.json', info(), 'auto-reply/info.json'), file('config.json', cfg, 'auto-reply/data/config.json'), file('init.lua', '--', 'auto-reply/init.lua')]);
    expect(r.status).toBe('picked');
    if (r.status !== 'picked') return;
    expect(r.source).toMatchObject({ kind: 'upload', name: 'auto-reply', pluginVersion: '0.5.0', canSaveInPlace: false });
    const loaded = await r.source.store.load();
    expect(loaded.status).toBe('ok');
  });

  test('a single config.json works, with the plugin version unknown', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('config.json', cfg)]);
    expect(r.status).toBe('picked');
    if (r.status === 'picked') {
      expect(r.source.pluginVersion).toBeNull();
      expect(r.source.features.versionKnown).toBe(false);
    }
  });

  test('another plugin or unrelated files are refused with a reason', async () => {
    const ws = await make();
    expect(await ws.openFiles([file('info.json', info('Something Else'), 'other/info.json')])).toEqual({ status: 'not-plugin', name: 'other' });
    expect((await ws.openFiles([file('notes.txt', 'hi')])).status).toBe('bad-selection');
    expect((await ws.openFiles([file('info.json', '{nope', 'x/info.json')])).status).toBe('bad-selection');
  });

  test('a plugin folder without data/config.json opens as "missing"; creating the default hands out a download', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('info.json', info(), 'auto-reply/info.json')]);
    if (r.status !== 'picked') throw new Error('expected picked');
    expect((await r.source.store.load()).status).toBe('missing');
    await r.source.store.createDefault();
    expect(downloads).toHaveLength(1);
    expect(JSON.parse(downloads[0]!.text)).toMatchObject({ version: 1, per_user_cooldown: 60 });
  });

  test('saving hands the user a download with exactly the new text; the next load sees it', async () => {
    const ws = await make();
    const r = await ws.openFiles([file('config.json', cfg)]);
    if (r.status !== 'picked') throw new Error('expected picked');
    const l = await r.source.store.load();
    if (l.status !== 'ok') throw new Error('load');
    const edited = structuredClone(l.config);
    edited.per_user_cooldown = 42;
    const saved = await r.source.store.save(l.snapshot.hash, edited);
    expect(saved.status).toBe('saved');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe('config.json');
    expect(JSON.parse(downloads[0]!.text).per_user_cooldown).toBe(42);
    expect(JSON.parse(downloads[0]!.text).channels).toEqual(['a']);
    const again = await r.source.store.load();
    expect(again.status === 'ok' && again.config.per_user_cooldown).toBe(42);
  });
});

describe('demo', () => {
  test('is an in-memory sample with the newest features; saving downloads', async () => {
    const ws = await make();
    const source = ws.startDemo();
    expect(source).toMatchObject({ kind: 'demo', canSaveInPlace: false, pluginVersion: '0.5.0' });
    expect(source.features.skipUsers).toBe(true);
    const l = await source.store.load();
    if (l.status !== 'ok') throw new Error('load');
    expect(l.config.rules).toHaveLength(2);
    expect(l.config.channels).toEqual(['streamer']);
    const edited = structuredClone(l.config);
    edited.global_min_gap = 5;
    await source.store.save(l.snapshot.hash, edited);
    expect(downloads).toHaveLength(1);
  });

  test('every demo is independent', async () => {
    const ws = await make();
    const a = ws.startDemo();
    const b = ws.startDemo();
    const la = await a.store.load();
    if (la.status !== 'ok') throw new Error('load');
    const edited = structuredClone(la.config);
    edited.per_user_cooldown = 9;
    await a.store.save(la.snapshot.hash, edited);
    const lb = await b.store.load();
    expect(lb.status === 'ok' && lb.config.per_user_cooldown).toBe(60);
  });
});

describe('capabilities', () => {
  test('without direct access and without storage it still starts empty', async () => {
    const ws = await make();
    expect(ws.directAccess).toBe(false);
    expect(ws.persistent()).toBe(false);
    expect(await ws.start()).toEqual({ status: 'none' });
  });
});
