import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { luaSources } from './sources.ts';

// `check_reply` lives in the plugin's engine.lua, which needs Chatterino and is not vendored. The UI keeps a thin copy
// (src/lua/uichecks.lua). This compares the copy with the plugin's real function, extracted from its source. Skipped
// when the plugin repo is not around (CI).
const repo = resolve(process.env.PLUGIN_REPO ?? '../auto-reply-plugin');
const engine = resolve(repo, 'auto-reply/engine.lua');

const inputs = ['', ' ', '\n\t', 'hi', 'Привет, {user}!', '/ban x', '.me x', ' /x', 'x'.repeat(500), 'x'.repeat(501), 'я'.repeat(251), 'я'.repeat(250), '{time}', 'a/b'];

describe.skipIf(!existsSync(engine))('check_reply copy (PLUGIN_REPO)', () => {
  let host: LuaHost;
  beforeAll(async () => {
    const src = readFileSync(engine, 'utf8');
    const m = /function E\.check_reply\(reply\)[\s\S]*?\nend\n/.exec(src);
    if (!m) throw new Error('E.check_reply not found in the plugin source');
    const sources = luaSources();
    const modules: Record<string, string> = { ...sources.modules, realengine: `local E = {}\n${m[0]}\nreturn E` };
    sources.modules = modules as typeof sources.modules;
    host = await createLuaHost(sources);
  });
  afterAll(() => host.close());

  test.each(inputs.map((s) => [JSON.stringify(s.length > 40 ? s.slice(0, 40) + '…' : s), s]))('same answer for %s', async (_label, input) => {
    const real = await host.call('realengine', 'check_reply', input);
    const copy = await host.call('uichecks', 'check_reply', input);
    expect(copy).toEqual(real);
  });
});
