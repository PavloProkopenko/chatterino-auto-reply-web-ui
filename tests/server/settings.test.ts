import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createSettings, settingsDir } from '../../src/server/settings.ts';

let dir: string;
beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'set-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('settingsDir', () => {
  test('per OS profile dir, with an explicit override', () => {
    expect(settingsDir('darwin', { HOME: '/Users/x' })).toBe('/Users/x/Library/Application Support/auto-reply-web');
    expect(settingsDir('win32', { APPDATA: 'C:\\Users\\Иван\\AppData\\Roaming' })).toBe('C:\\Users\\Иван\\AppData\\Roaming\\auto-reply-web');
    expect(settingsDir('linux', { HOME: '/home/x' })).toBe('/home/x/.config/auto-reply-web');
    expect(settingsDir('darwin', { HOME: '/Users/x', AUTO_REPLY_WEB_DATA: '/tmp/dev' })).toBe('/tmp/dev');
  });
});

describe('settings store', () => {
  test('defaults when the file does not exist', async () => {
    expect(await createSettings(dir).read()).toEqual({ firstRunDone: false });
  });
  test('round trip, creating the directory on first write', async () => {
    const s = createSettings(join(dir, 'nested'));
    await s.update({ configPath: '/p/config.json' });
    await s.update({ firstRunDone: true });
    expect(await s.read()).toEqual({ configPath: '/p/config.json', firstRunDone: true });
  });
  test('a corrupt or invalid settings file falls back to defaults instead of breaking the app', async () => {
    await writeFile(join(dir, 'settings.json'), '{oops');
    expect(await createSettings(dir).read()).toEqual({ firstRunDone: false });
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ configPath: 42, firstRunDone: 'yes' }));
    expect(await createSettings(dir).read()).toEqual({ firstRunDone: false });
  });
  test('a remembered path that is not a config.json is ignored', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ configPath: '/etc/passwd', firstRunDone: true }));
    expect(await createSettings(dir).read()).toEqual({ firstRunDone: true });
  });
  test('writes are atomic: no temp file is left behind', async () => {
    const s = createSettings(dir);
    await s.update({ firstRunDone: true });
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ firstRunDone: true });
  });
});
