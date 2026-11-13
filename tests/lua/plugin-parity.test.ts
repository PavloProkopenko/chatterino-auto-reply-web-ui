import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { luaSources } from './sources.ts';

// Local cross-check against the plugin repo's own unit table. Skipped when the plugin repo is not around (CI).
const repo = resolve(process.env.PLUGIN_REPO ?? '../auto-reply-plugin');
const file = resolve(repo, 'auto-reply/tests/cases/unit_rules.lua');

const luaString = (s: string) =>
  s.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/\\"/g, '"').replace(/\\\\/g, '\\');

function readCases(): [string, string, string, boolean][] {
  const rows: [string, string, string, boolean][] = [];
  const re = /\{\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",\s*(true|false)\s*\}/g;
  for (const m of readFileSync(file, 'utf8').matchAll(re)) rows.push([luaString(m[1]!), luaString(m[2]!), luaString(m[3]!), m[4] === 'true']);
  return rows;
}

describe.skipIf(!existsSync(file))('plugin unit_rules table (PLUGIN_REPO)', () => {
  let host: LuaHost;
  beforeAll(async () => {
    host = await createLuaHost(luaSources());
  });
  afterAll(() => host.close());

  test("every case gives the plugin's expected answer through the WASM host", async () => {
    const cases = readCases();
    expect(cases.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const [type, match, text, expected] of cases) {
      const [got] = await host.call('rules', 'matches_one', { type, match }, text, 0, 'inflame_dt');
      if ((got === true) !== expected) bad.push(`${type} ${JSON.stringify(match)} on ${JSON.stringify(text)}: expected ${expected}`);
    }
    expect(bad).toEqual([]);
  });
});
