import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const vendor = (f: string) => readFileSync(fileURLToPath(new URL(`../../vendor/plugin/${f}`, import.meta.url)), 'utf8');
const own = (f: string) => readFileSync(fileURLToPath(new URL(`../../src/lua/${f}`, import.meta.url)), 'utf8');

/** Lua sources for the host, read from disk (the browser build injects the same strings through Vite). */
export function luaSources() {
  return {
    modules: {
      util: vendor('util.lua'),
      rules: vendor('rules.lua'),
      names: vendor('names.lua'),
      config: vendor('config.lua'),
      uichecks: own('uichecks.lua'),
    },
    shim: own('shim.lua'),
    json: own('json.lua'),
    bridge: own('bridge.lua'),
  };
}
