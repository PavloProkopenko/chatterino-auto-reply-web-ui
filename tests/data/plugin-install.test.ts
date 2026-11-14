import { describe, expect, test } from 'vitest';
import { MemoryDir } from './memory-dir.ts';
import { inspectPlugin, installPlugin, listPluginBackups, rollbackPlugin, updatePlugin, type PluginBundle } from '../../src/ui/data/plugin-install.ts';
import { sha256 } from '../../src/ui/data/store.ts';

async function bundle(version: string, extra: Record<string, string> = {}): Promise<PluginBundle> {
  const texts: Record<string, string> = {
    'info.json': JSON.stringify({ name: 'Auto Reply', version }),
    'init.lua': `-- init ${version}\n`,
    'rules.lua': `-- rules ${version}\nlocal s = "привет"\n`,
    ...extra,
  };
  const files: PluginBundle['files'] = {};
  for (const [name, text] of Object.entries(texts)) files[name] = { text, hash: await sha256(text) };
  return { version, files };
}
const now = () => 1_800_000_000_000;

describe('inspectPlugin', () => {
  test('empty folder is "missing", a stranger folder is "foreign"', async () => {
    const b = await bundle('1.0.0');
    expect((await inspectPlugin(new MemoryDir(), b)).state).toBe('missing');
    expect((await inspectPlugin(new MemoryDir({ 'notes.txt': 'x' }), b)).state).toBe('foreign');
    expect((await inspectPlugin(new MemoryDir({ 'info.json': JSON.stringify({ name: 'Other', version: '1.0.0' }) }), b)).state).toBe('foreign');
    expect((await inspectPlugin(new MemoryDir({ 'info.json': '{ nope' }), b)).state).toBe('foreign');
  });
  test('current, older, newer and modified', async () => {
    const b = await bundle('1.0.0');
    const same = new MemoryDir(Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.text])));
    expect((await inspectPlugin(same, b)).state).toBe('current');
    const older = new MemoryDir(Object.fromEntries(Object.entries((await bundle('0.9.0')).files).map(([n, f]) => [n, f.text])));
    expect(await inspectPlugin(older, b)).toMatchObject({ state: 'older', installedVersion: '0.9.0', bundledVersion: '1.0.0' });
    const newer = new MemoryDir(Object.fromEntries(Object.entries((await bundle('1.1.0')).files).map(([n, f]) => [n, f.text])));
    expect((await inspectPlugin(newer, b)).state).toBe('newer');
    same.files.set('rules.lua', '-- edited by hand\n');
    expect(await inspectPlugin(same, b)).toMatchObject({ state: 'modified', changedFiles: ['rules.lua'] });
  });
});

describe('installPlugin', () => {
  test('writes every bundled file and the external marker into an empty folder', async () => {
    const b = await bundle('1.0.0');
    const dir = new MemoryDir();
    expect(await installPlugin(dir, b)).toEqual({ status: 'installed' });
    for (const [n, f] of Object.entries(b.files)) expect(dir.files.get(n)).toBe(f.text);
    expect(dir.files.has('data/.external')).toBe(true);
    expect((await inspectPlugin(dir, b)).state).toBe('current');
  });
  test('refuses a folder that is not empty and not the plugin', async () => {
    const dir = new MemoryDir({ 'notes.txt': 'keep me' });
    expect(await installPlugin(dir, await bundle('1.0.0'))).toEqual({ status: 'refused', reason: 'foreign' });
    expect([...dir.files.keys()]).toEqual(['notes.txt']);
  });
  test('refuses when the plugin is already there', async () => {
    const b = await bundle('1.0.0');
    const dir = new MemoryDir(Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.text])));
    expect(await installPlugin(dir, b)).toEqual({ status: 'refused', reason: 'exists' });
  });
});

describe('updatePlugin and rollbackPlugin', () => {
  async function installedOld() {
    const old = await bundle('0.9.0', { 'gone.lua': '-- removed later\n' });
    const dir = new MemoryDir(Object.fromEntries(Object.entries(old.files).map(([n, f]) => [n, f.text])));
    dir.files.set('data/config.json', '{"version":1,"channels":["x"]}\n');
    dir.files.set('data/.external', '');
    dir.files.set('notes.txt', 'my notes');
    dir.files.set('tests/secret.lua', '-- must stay\n');
    return { dir, old };
  }
  test('backs up old code, overwrites, and leaves data/, unknown files and subfolders untouched', async () => {
    const { dir, old } = await installedOld();
    const next = await bundle('1.0.0');
    const before = new Map(dir.files);
    expect(await updatePlugin(dir, next, now)).toEqual({ status: 'updated', from: '0.9.0', backup: '0.9.0' });
    for (const [n, f] of Object.entries(next.files)) expect(dir.files.get(n)).toBe(f.text);
    for (const [n, f] of Object.entries(old.files)) expect(dir.files.get(`.backup/0.9.0/${n}`)).toBe(f.text);
    expect(dir.files.get('.backup/0.9.0/gone.lua')).toBe('-- removed later\n');
    for (const k of ['data/config.json', 'data/.external', 'notes.txt', 'tests/secret.lua', 'gone.lua']) expect(dir.files.get(k)).toBe(before.get(k));
    expect((await inspectPlugin(dir, next)).state).toBe('current');
  });
  test('a failed backup stops the update before anything is overwritten', async () => {
    const { dir } = await installedOld();
    dir.failWritesTo = /^\.backup\//;
    const before = new Map(dir.files);
    const r = await updatePlugin(dir, await bundle('1.0.0'), now);
    expect(r.status).toBe('failed');
    expect(dir.files).toEqual(before);
  });
  test('refuses when already current', async () => {
    const b = await bundle('1.0.0');
    const dir = new MemoryDir(Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.text])));
    expect(await updatePlugin(dir, b, now)).toEqual({ status: 'refused', reason: 'current' });
  });
  test('refuses to downgrade and to touch a foreign folder', async () => {
    const b = await bundle('1.0.0');
    const newer = new MemoryDir(Object.fromEntries(Object.entries((await bundle('1.1.0')).files).map(([n, f]) => [n, f.text])));
    expect(await updatePlugin(newer, b, now)).toEqual({ status: 'refused', reason: 'newer' });
    expect(await updatePlugin(new MemoryDir({ 'a.txt': 'x' }), b, now)).toEqual({ status: 'refused', reason: 'foreign' });
  });
  test('a hand-edited current install can be restored to the bundled files (with backup)', async () => {
    const b = await bundle('1.0.0');
    const dir = new MemoryDir(Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.text])));
    dir.files.set('rules.lua', '-- edited\n');
    expect((await updatePlugin(dir, b, now)).status).toBe('updated');
    expect(dir.files.get('rules.lua')).toBe(b.files['rules.lua']!.text);
    expect(dir.files.get('.backup/1.0.0/rules.lua')).toBe('-- edited\n');
  });
  test('a second backup of the same version gets a numbered name', async () => {
    const b = await bundle('1.0.0');
    const dir = new MemoryDir(Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.text])));
    dir.files.set('rules.lua', '-- edit 1\n');
    await updatePlugin(dir, b, now);
    dir.files.set('rules.lua', '-- edit 2\n');
    const r = await updatePlugin(dir, b, now);
    expect(r).toMatchObject({ status: 'updated', backup: '1.0.0-2' });
  });
  test('rollback restores the newest backup, and itself backs up the current code', async () => {
    const { dir, old } = await installedOld();
    const next = await bundle('1.0.0');
    await updatePlugin(dir, next, now);
    expect((await listPluginBackups(dir)).map((x) => x.name)).toEqual(['0.9.0']);
    expect(await rollbackPlugin(dir, now)).toMatchObject({ status: 'rolled-back', restored: '0.9.0' });
    for (const [n, f] of Object.entries(old.files)) expect(dir.files.get(n)).toBe(f.text);
    expect(dir.files.get('data/config.json')).toBe('{"version":1,"channels":["x"]}\n');
    expect((await listPluginBackups(dir))[0]?.name).toBe('1.0.0'); // the undone version can be brought back
  });
  test('rollback with no backup is refused', async () => {
    expect(await rollbackPlugin(new MemoryDir({ 'info.json': '{}' }), now)).toEqual({ status: 'refused', reason: 'no-backup' });
  });
});
