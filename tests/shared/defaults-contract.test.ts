import { afterAll, beforeAll, expect, test } from 'vitest';
import { createLuaHost, type LuaHost } from '../../src/lua/host.ts';
import { DEFAULTS, normalise, type JsonObject } from '../../src/shared/config.ts';
import { luaSources } from '../lua/sources.ts';

let host: LuaHost;
beforeAll(async () => (host = await createLuaHost(luaSources())));
afterAll(() => host.close());

test('DEFAULTS equals config.defaults() of the vendored plugin', async () => {
  const [lua] = (await host.call('config', 'defaults')) as [JsonObject];
  expect(normalise(lua)).toEqual(normalise({ ...DEFAULTS }));
  expect(Object.keys(lua).sort()).toEqual(Object.keys(DEFAULTS).sort());
});
