import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defaultRoots, discover, inspectConfigPath } from '../../src/server/discover.ts';

let root: string;
beforeEach(async () => (root = await mkdtemp(join(tmpdir(), 'disc-'))));
afterEach(() => rm(root, { recursive: true, force: true }));

async function plugin(appFolder: string, pluginFolder: string, info: object | string, withConfig = true, mtime?: Date) {
  const dir = join(root, appFolder, 'Plugins', pluginFolder);
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'info.json'), typeof info === 'string' ? info : JSON.stringify(info));
  if (withConfig) {
    const cfg = join(dir, 'data', 'config.json');
    await writeFile(cfg, '{}');
    if (mtime) await utimes(cfg, mtime, mtime);
  }
  return dir;
}

describe('discover', () => {
  test('finds the plugin by content, whatever the app and plugin folders are called', async () => {
    const d = await plugin('Chatterino by Mist1X', 'whatever-name', { name: 'Auto Reply', version: '0.5.0' });
    await plugin('chatterino', 'other-plugin', { name: 'Something Else', version: '1.0.0' });
    const found = await discover([root]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ configPath: join(d, 'data', 'config.json'), pluginVersion: '0.5.0', configExists: true, appFolder: 'Chatterino by Mist1X' });
  });

  test('lists several installs, most recently modified config first', async () => {
    await plugin('chatterino', 'auto-reply', { name: 'Auto Reply', version: '0.4.0' }, true, new Date('2026-01-01'));
    await plugin('leafyrino', 'auto-reply', { name: 'Auto Reply', version: '0.5.0' }, true, new Date('2026-06-01'));
    const found = await discover([root]);
    expect(found.map((c) => c.appFolder)).toEqual(['leafyrino', 'chatterino']);
  });

  test('a plugin that never ran has no config yet but is still offered', async () => {
    const d = await plugin('chatterino', 'auto-reply', { name: 'Auto Reply', version: '0.5.0' }, false);
    const [c] = await discover([root]);
    expect(c).toMatchObject({ configPath: join(d, 'data', 'config.json'), configExists: false });
  });

  test('skips broken info.json files and missing roots without failing', async () => {
    await plugin('chatterino', 'broken', '{not json');
    await plugin('chatterino', 'ok', { name: 'Auto Reply', version: '0.5.0' });
    const found = await discover([root, join(root, 'does-not-exist')]);
    expect(found).toHaveLength(1);
  });

  test('works under a Cyrillic user path', async () => {
    const cyr = join(root, 'Пользователь');
    await mkdir(cyr, { recursive: true });
    await mkdir(join(cyr, 'Chatterino', 'Plugins', 'auto-reply', 'data'), { recursive: true });
    await writeFile(join(cyr, 'Chatterino', 'Plugins', 'auto-reply', 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
    expect(await discover([cyr])).toHaveLength(1);
  });
});

describe('defaultRoots', () => {
  test('per platform', () => {
    expect(defaultRoots('darwin', { HOME: '/Users/x' })).toEqual(['/Users/x/Library/Application Support']);
    expect(defaultRoots('win32', { APPDATA: 'C:\\Users\\Иван\\AppData\\Roaming' })).toEqual(['C:\\Users\\Иван\\AppData\\Roaming']);
    expect(defaultRoots('linux', { HOME: '/home/x' })).toEqual(['/home/x/.local/share']);
    expect(defaultRoots('win32', {})).toEqual([]);
  });
});

describe('inspectConfigPath (typed path fallback)', () => {
  test('accepts config.json next to a proper plugin info.json', async () => {
    const d = await plugin('chatterino', 'auto-reply', { name: 'Auto Reply', version: '0.5.0' });
    expect(await inspectConfigPath(join(d, 'data', 'config.json'))).toMatchObject({ ok: true, warnings: [], pluginVersion: '0.5.0', exists: true });
  });
  test('rejects any file not named config.json', async () => {
    expect(await inspectConfigPath(join(root, 'settings.json'))).toMatchObject({ ok: false });
  });
  test('warns when there is no sibling info.json for Auto Reply', async () => {
    const d = join(root, 'x', 'data');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'config.json'), '{}');
    const r = await inspectConfigPath(join(d, 'config.json'));
    expect(r.ok && r.warnings).toEqual(['no-plugin-info']);
  });
  test('warns when info.json belongs to another plugin', async () => {
    const d = await plugin('x', 'p', { name: 'Not Auto Reply', version: '1.0.0' });
    const r = await inspectConfigPath(join(d, 'data', 'config.json'));
    expect(r.ok && r.warnings).toEqual(['other-plugin']);
  });
});
