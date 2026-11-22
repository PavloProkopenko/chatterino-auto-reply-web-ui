import { describe, expect, test } from 'vitest';
import { ru } from '../../src/i18n/ru.ts';
import { runPluginUpdate, updateAvailable } from '../../src/ui/data/plugin-update.ts';
import type { PluginBundle } from '../../src/ui/data/plugin-install.ts';
import { sha256 } from '../../src/ui/data/store.ts';
import { MemoryDir } from './memory-dir.ts';

async function bundle(version: string): Promise<PluginBundle> {
  const texts: Record<string, string> = { 'info.json': JSON.stringify({ name: 'Auto Reply', version }), 'init.lua': `-- ${version}\n` };
  const files: PluginBundle['files'] = {};
  for (const [name, text] of Object.entries(texts)) files[name] = { text, hash: await sha256(text) };
  return { version, files };
}
const folderWith = async (version: string) => new MemoryDir(Object.fromEntries(Object.entries((await bundle(version)).files).map(([n, f]) => [n, f.text])));

describe('updateAvailable', () => {
  test.each([
    ['0.8.0', '0.8.1', true],
    ['0.8.1', '0.8.1', false],
    ['0.9.0', '0.8.1', false],
    ['0.10.0', '0.9.0', false],
    [null, '0.8.1', false], // unknown version: do not offer, the plugin panel explains
    ['weird', '0.8.1', true], // unparsable counts as 0.0.0, older than anything
  ])('installed %s, bundled %s -> %s', (installed, bundled, expected) => expect(updateAvailable(installed, bundled)).toBe(expected));
});

describe('runPluginUpdate', () => {
  test('older plugin: updated, backup kept, restart hint returned', async () => {
    const dir = await folderWith('0.8.0');
    const out = await runPluginUpdate(dir, await bundle('0.8.1'));
    expect(out).toEqual({ kind: 'ok', text: ru.plugin.done.updated('0.8.0', '0.8.0') });
    expect(JSON.parse((await dir.read('info.json'))!).version).toBe('0.8.1');
    expect(await dir.read('.backup/0.8.0/init.lua')).toBe('-- 0.8.0\n');
  });
  test('already current: refused with the standard message, nothing changes', async () => {
    const dir = await folderWith('0.8.1');
    const out = await runPluginUpdate(dir, await bundle('0.8.1'));
    expect(out).toEqual({ kind: 'error', text: ru.plugin.problem.refused });
    expect(await dir.list('.backup')).toBeNull();
  });
  test('a write failure is reported and never throws', async () => {
    const dir = await folderWith('0.8.0');
    dir.failWritesTo = /info\.json$/;
    const out = await runPluginUpdate(dir, await bundle('0.8.1'));
    expect(out.kind).toBe('error');
  });
});
